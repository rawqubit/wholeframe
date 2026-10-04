import {
  CAPTURE_MIN_INTERVAL_MS,
  CAPTURE_QUOTA_BACKOFF_MS,
  CAPTURE_QUOTA_RETRIES,
  captureQuotaDelay,
  filenameFor,
  isCaptureQuotaError,
  nextCaptureSlot,
  outputSize,
  planSlices,
} from "./plan.js";

const MAX_CSS_HEIGHT = 50000;
const DEFAULTS = {
  delay: 0,
  hideSticky: true,
  lazy: true,
};

let running = false;
/** Earliest time the next captureVisibleTab call may start. Chrome allows 2/s. */
let nextCaptureAt = 0;

function drawIcon(size) {
  const canvas = new OffscreenCanvas(size, size);
  const g = canvas.getContext("2d");
  const radius = Math.max(2, Math.round(size * 0.22));
  g.clearRect(0, 0, size, size);
  g.fillStyle = "#1c1915";
  round(g, 0, 0, size, size, radius);
  g.fill();

  const inset = size * 0.2;
  const pageX = inset;
  const pageY = size * 0.16;
  const pageW = size - inset * 2;
  const pageH = size * 0.7;
  g.fillStyle = "#f4f0e6";
  round(g, pageX, pageY, pageW, pageH, Math.max(1, radius * 0.35));
  g.fill();

  g.fillStyle = "#d6412a";
  const barH = Math.max(2, Math.round(size * 0.1));
  const barY = pageY + pageH * 0.62;
  g.fillRect(pageX, barY, pageW, barH);

  g.fillStyle = "#1c1915";
  const line = Math.max(1, Math.round(size * 0.045));
  const gap = line * 2.1;
  let y = pageY + size * 0.12;
  const textX = pageX + size * 0.1;
  const textW = pageW * 0.62;
  for (let i = 0; i < 3; i++) {
    if (y > barY - line) break;
    g.fillRect(textX, y, i === 2 ? textW * 0.55 : textW, line);
    y += gap;
  }
  return g.getImageData(0, 0, size, size);
}

function round(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.closePath();
}

async function paintIcons() {
  const imageData = {
    16: drawIcon(16),
    32: drawIcon(32),
    48: drawIcon(48),
  };
  await chrome.action.setIcon({ imageData });
}

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "capture-full",
      title: "Capture full page",
      contexts: ["page", "action"],
    });
    chrome.contextMenus.create({
      id: "capture-visible",
      title: "Capture visible area",
      contexts: ["page", "action"],
    });
  });
}

paintIcons().catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  paintIcons().catch(() => {});
  setupMenus();
});

chrome.runtime.onStartup.addListener(() => {
  paintIcons().catch(() => {});
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "capture-full") startCapture("full").catch(rememberError);
  if (command === "capture-visible") startCapture("visible").catch(rememberError);
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "capture-full") startCapture("full").catch(rememberError);
  if (info.menuItemId === "capture-visible") startCapture("visible").catch(rememberError);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;
  if (msg.type === "wf-settings-get") {
    getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }
  if (msg.type === "wf-settings-set") {
    chrome.storage.local.set({ settings: sanitizeSettings(msg.settings) }).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: String(err) }),
    );
    return true;
  }
  if (msg.type === "wf-start") {
    startCapture(msg.mode === "visible" ? "visible" : "full").then(
      (result) => sendResponse({ ok: true, result }),
      (err) => sendResponse({ ok: false, error: err?.message || String(err) }),
    );
    return true;
  }
  if (msg.type === "wf-status") {
    chrome.storage.session.get(["lastError", "lastResult"]).then((stored) => sendResponse({ ok: true, ...stored }));
    return true;
  }
  return false;
});

function sanitizeSettings(input) {
  const delay = Number(input?.delay);
  return {
    delay: [0, 1, 2, 3].includes(delay) ? delay : 0,
    hideSticky: input?.hideSticky !== false,
    lazy: input?.lazy !== false,
  };
}

async function getSettings() {
  const stored = await chrome.storage.local.get("settings");
  return sanitizeSettings(stored.settings || DEFAULTS);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureFrame(windowId) {
  for (let attempt = 0; attempt <= CAPTURE_QUOTA_RETRIES; attempt++) {
    const wait = captureQuotaDelay(Date.now(), nextCaptureAt);
    if (wait > 0) await sleep(wait);
    let dataUrl = "";
    let message = "";
    try {
      dataUrl = (await chrome.tabs.captureVisibleTab(windowId, { format: "png" })) || "";
    } catch (err) {
      message = err?.message || String(err);
    }
    if (!message && chrome.runtime.lastError?.message) {
      message = chrome.runtime.lastError.message;
    }
    // Count the gap from when this call finished, not when it started.
    nextCaptureAt = nextCaptureSlot(Date.now(), CAPTURE_MIN_INTERVAL_MS);
    if (dataUrl && !message) return dataUrl;
    const quota = isCaptureQuotaError(message);
    if (!quota || attempt === CAPTURE_QUOTA_RETRIES) {
      if (quota) {
        throw new Error("Chrome is limiting screenshots right now. Wait a moment and try again.");
      }
      throw new Error(message || "Chrome did not return an image.");
    }
    nextCaptureAt = nextCaptureSlot(Date.now(), CAPTURE_QUOTA_BACKOFF_MS);
  }
  throw new Error("Chrome is limiting screenshots right now. Wait a moment and try again.");
}

async function rememberError(err) {
  const message = err?.message || String(err);
  await chrome.storage.session.set({ lastError: message, lastResult: null });
  await chrome.action.setBadgeBackgroundColor({ color: "#d6412a" });
  await chrome.action.setBadgeText({ text: "!" });
  broadcast({ type: "wf-progress", phase: "error", error: message });
}

function broadcast(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {});
}

async function callPage(tabId, method, args = []) {
  let injected;
  try {
    injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (name, params) => {
        const api = globalThis.__wholeframe;
        if (!api || typeof api[name] !== "function") {
          return { __error: "Wholeframe could not run on this page." };
        }
        try {
          const value = await api[name](...params);
          return { value: value ?? null };
        } catch (err) {
          return { __error: err?.message || String(err) };
        }
      },
      args: [method, args],
    });
  } catch (err) {
    throw new Error(accessMessage(err));
  }
  const row = injected?.[0];
  if (!row || row.result?.__error) {
    throw new Error(row?.result?.__error || "Could not read this page.");
  }
  return row.result?.value;
}

function accessMessage(err) {
  const raw = err?.message || String(err);
  if (/cannot be scripted|extensions gallery|cannot access/i.test(raw)) {
    return "Chrome blocks extensions on this page. Open a normal website and try again.";
  }
  return raw || "Could not access this tab.";
}

function blockedUrl(url) {
  if (!url) return "Open a web page first.";
  if (/^(chrome|chrome-extension|edge|about|devtools|view-source|chrome-untrusted):/i.test(url)) {
    return "This browser page can't be captured. Open a normal website and try again.";
  }
  if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url)) {
    return "The Chrome Web Store blocks extensions. Try another site.";
  }
  return null;
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Stitch scrolled screenshots into one full-page image.",
    });
  }
  let lastError = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      await stitch({ op: "ping" });
      return;
    } catch (err) {
      lastError = err;
      await sleep(40);
    }
  }
  throw new Error(lastError?.message || "Could not start the capture workspace.");
}

function stitch(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const port = chrome.runtime.connect({ name: "stitch" });
    const timer = setTimeout(() => {
      try { port.disconnect(); } catch { /* already closed */ }
      finish(reject, new Error("Stitching the screenshot took too long."));
    }, 120000);
    port.onMessage.addListener((response) => {
      if (response?.ok) finish(resolve, response.result);
      else finish(reject, new Error(response?.error || "Could not stitch the screenshot."));
      try { port.disconnect(); } catch { /* already closed */ }
    });
    port.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message;
      finish(reject, new Error(reason || "The capture workspace closed."));
    });
    try {
      port.postMessage(message);
    } catch (err) {
      finish(reject, err);
    }
  });
}

async function startCapture(mode) {
  if (running) throw new Error("A capture is already running.");
  running = true;
  const started = Date.now();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab to capture.");
    const blocked = blockedUrl(tab.url || "");
    if (blocked) throw new Error(blocked);

    const settings = await getSettings();
    await chrome.storage.session.set({ lastError: null });
    await chrome.action.setBadgeBackgroundColor({ color: "#1c1915" });
    await chrome.action.setBadgeText({ text: "..." });

    if (settings.delay > 0) {
      broadcast({ type: "wf-progress", phase: "wait", delay: settings.delay });
      await sleep(settings.delay * 1000);
    }

    broadcast({ type: "wf-progress", phase: "prepare", progress: 0 });
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page.js"] });
    } catch (err) {
      throw new Error(accessMessage(err));
    }

    let metrics = await callPage(tab.id, "prepare");
    try {
      if (mode === "full" && settings.lazy) {
        broadcast({ type: "wf-progress", phase: "warm", progress: 0.02 });
        metrics = await callPage(tab.id, "warm", [MAX_CSS_HEIGHT]);
      } else {
        metrics = await callPage(tab.id, "metrics");
      }

      if (mode === "visible") {
        await ensureOffscreen();
        const dataUrl = await captureFrame(tab.windowId);
        const saved = await stitch({
          op: "visible",
          dataUrl,
          meta: metaFrom(metrics, false, false),
        });
        return await finish(saved, started);
      }

      const capped = metrics.fullHeight > MAX_CSS_HEIGHT;
      const fullHeight = Math.min(metrics.fullHeight, MAX_CSS_HEIGHT);
      const fullWidth = metrics.kind === "element" ? metrics.crop.w : metrics.viewportWidth;
      const slices = planSlices(fullHeight, metrics.viewportHeight);
      if (!slices.length) throw new Error("This page has nothing to capture.");

      const size = outputSize(fullWidth, fullHeight, metrics.dpr);
      await ensureOffscreen();
      await stitch({
        op: "begin",
        width: size.width,
        height: size.height,
        cssWidth: fullWidth,
        cssHeight: fullHeight,
      });

      for (let i = 0; i < slices.length; i++) {
        const slice = slices[i];
        const pos = await callPage(tab.id, "scrollToPos", [slice.scrollTarget]);
        if (settings.hideSticky) {
          await callPage(tab.id, "setPass", [i === 0 ? "first" : "rest"]);
        }
        await callPage(tab.id, "waitPaint");
        await sleep(i === 0 ? 60 : 40);
        const dataUrl = await captureFrame(tab.windowId);
        const srcOffset = slice.dest - pos.scrollY;
        await stitch({
          op: "draw",
          dataUrl,
          srcOffsetCss: srcOffset,
          drawHeightCss: slice.drawHeight,
          destCss: slice.dest,
          viewportCss: pos.viewportHeight,
          crop: pos.crop,
          windowWidth: pos.windowWidth,
          windowHeight: pos.windowHeight,
        });
        const progress = (i + 1) / slices.length;
        await chrome.action.setBadgeText({ text: String(Math.round(progress * 100)) });
        broadcast({ type: "wf-progress", phase: "capture", progress, index: i + 1, total: slices.length });
      }

      const saved = await stitch({
        op: "finish",
        meta: metaFrom(metrics, capped, size.reduced),
      });
      return await finish(saved, started);
    } finally {
      try { await callPage(tab.id, "restore"); } catch { /* page may have closed */ }
    }
  } catch (err) {
    await rememberError(err);
    throw err;
  } finally {
    running = false;
  }
}

function metaFrom(metrics, capped, reduced) {
  return {
    title: metrics.title,
    url: metrics.url,
    capped,
    reduced,
    filename: filenameFor(metrics.title),
  };
}

async function finish(saved, started) {
  const result = {
    ...saved,
    ms: Date.now() - started,
  };
  await chrome.storage.session.set({ lastError: null, lastResult: result });
  await chrome.action.setBadgeText({ text: "" });
  await chrome.tabs.create({ url: chrome.runtime.getURL("preview.html") });
  broadcast({ type: "wf-progress", phase: "done", result });
  return result;
}
