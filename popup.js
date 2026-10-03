const fullBtn = document.querySelector("#full");
const visibleBtn = document.querySelector("#visible");
const delayGroup = document.querySelector("#delay");
const hideSticky = document.querySelector("#hideSticky");
const lazy = document.querySelector("#lazy");
const statusEl = document.querySelector("#status");
const track = document.querySelector("#track");
const bar = document.querySelector("#bar");
const modKey = document.querySelector("#mod");

const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
if (mac && modKey) modKey.textContent = "\u2318";

let settings = { delay: 0, hideSticky: true, lazy: true };

function renderSettings() {
  hideSticky.checked = settings.hideSticky;
  lazy.checked = settings.lazy;
  for (const button of delayGroup.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.delay) === settings.delay));
  }
}

function setBusy(busy) {
  fullBtn.disabled = busy;
  visibleBtn.disabled = busy;
}

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", Boolean(isError));
}

async function save(partial) {
  settings = { ...settings, ...partial };
  renderSettings();
  await chrome.runtime.sendMessage({ type: "wf-settings-set", settings });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "wf-progress") return;
  if (msg.phase === "wait") {
    track.hidden = true;
    setStatus(`Capturing in ${msg.delay}s \u2014 dismiss anything covering the page.`);
  } else if (msg.phase === "warm") {
    track.hidden = false;
    bar.style.width = "8%";
    setStatus("Scrolling to load images\u2026");
  } else if (msg.phase === "prepare") {
    track.hidden = false;
    bar.style.width = "4%";
    setStatus("Measuring the page\u2026");
  } else if (msg.phase === "capture") {
    track.hidden = false;
    const pct = Math.round((msg.progress || 0) * 100);
    bar.style.width = `${pct}%`;
    setStatus(`Stitching ${msg.index} of ${msg.total}`);
  } else if (msg.phase === "done") {
    track.hidden = false;
    bar.style.width = "100%";
    setStatus("Opening the screenshot\u2026");
    setBusy(false);
  } else if (msg.phase === "error") {
    track.hidden = true;
    setStatus(msg.error || "Capture failed.", true);
    setBusy(false);
  }
});

delayGroup.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  save({ delay: Number(button.dataset.delay) });
});

hideSticky.addEventListener("change", () => save({ hideSticky: hideSticky.checked }));
lazy.addEventListener("change", () => save({ lazy: lazy.checked }));

async function run(mode) {
  setBusy(true);
  track.hidden = false;
  bar.style.width = "2%";
  setStatus(mode === "full" ? "Starting full-page capture\u2026" : "Capturing the visible area\u2026");
  const response = await chrome.runtime.sendMessage({ type: "wf-start", mode });
  if (!response?.ok) {
    setBusy(false);
    track.hidden = true;
    setStatus(response?.error || "Capture failed.", true);
  }
}

fullBtn.addEventListener("click", () => run("full"));
visibleBtn.addEventListener("click", () => run("visible"));

const initial = await chrome.runtime.sendMessage({ type: "wf-settings-get" });
if (initial?.settings) settings = initial.settings;
renderSettings();

const status = await chrome.runtime.sendMessage({ type: "wf-status" });
if (status?.lastError) setStatus(status.lastError, true);
