import { filenameFor } from "./plan.js";

let canvas = null;
let cssWidth = 1;
let cssHeight = 1;

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("wholeframe", 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains("shots")) {
        database.createObjectStore("shots", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveShot(record) {
  const database = await db();
  await new Promise((resolve, reject) => {
    const tx = database.transaction("shots", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore("shots").put(record);
  });
  database.close();
}

function span(startCss, endCss, totalCss, totalPx) {
  const safeTotal = Math.max(1, totalCss);
  const a = Math.round((startCss / safeTotal) * totalPx);
  const b = Math.round((endCss / safeTotal) * totalPx);
  return [a, Math.max(1, b - a)];
}

async function bitmapFrom(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

async function handle(message) {
  if (message.op === "ping") return { ready: true };

  if (message.op === "visible") {
    const bmp = await bitmapFrom(message.dataUrl);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await c.convertToBlob({ type: "image/png" });
    const meta = message.meta || {};
    const record = {
      id: "latest",
      blob,
      width: c.width,
      height: c.height,
      bytes: blob.size,
      title: meta.title || "Visible area",
      url: meta.url || "",
      filename: meta.filename || filenameFor(meta.title),
      capped: false,
      reduced: false,
      mode: "visible",
      created: Date.now(),
    };
    await saveShot(record);
    return publicResult(record);
  }

  if (message.op === "begin") {
    cssWidth = Math.max(1, message.cssWidth || 1);
    cssHeight = Math.max(1, message.cssHeight || 1);
    canvas = new OffscreenCanvas(message.width, message.height);
    const g = canvas.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height };
  }

  if (message.op === "draw") {
    if (!canvas) throw new Error("Capture was not started.");
    const bmp = await bitmapFrom(message.dataUrl);
    const g = canvas.getContext("2d");
    const winW = Math.max(1, message.windowWidth || bmp.width);
    const winH = Math.max(1, message.windowHeight || bmp.height);
    const crop = message.crop || { x: 0, y: 0, w: winW, h: message.viewportCss || winH };
    const scaleX = bmp.width / winW;
    const scaleY = bmp.height / winH;
    const viewCss = Math.max(1, message.viewportCss || crop.h || winH);
    const srcOffset = Math.max(0, Math.min(viewCss - 1, message.srcOffsetCss || 0));
    const drawHeight = Math.max(1, Math.min(viewCss - srcOffset, message.drawHeightCss || viewCss));

    const srcX = Math.round(crop.x * scaleX);
    const srcY = Math.round((crop.y + srcOffset) * scaleY);
    const srcW = Math.max(1, Math.round(crop.w * scaleX));
    const srcH = Math.max(1, Math.round(drawHeight * scaleY));

    const [destY, destH] = span(message.destCss || 0, (message.destCss || 0) + drawHeight, cssHeight, canvas.height);
    const destW = canvas.width;
    g.drawImage(
      bmp,
      clamp(srcX, 0, bmp.width - 1),
      clamp(srcY, 0, bmp.height - 1),
      clamp(srcW, 1, bmp.width - clamp(srcX, 0, bmp.width - 1)),
      clamp(srcH, 1, bmp.height - clamp(srcY, 0, bmp.height - 1)),
      0,
      destY,
      destW,
      destH,
    );
    bmp.close();
    return { destY, destH };
  }

  if (message.op === "finish") {
    if (!canvas) throw new Error("Nothing was captured.");
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const meta = message.meta || {};
    const record = {
      id: "latest",
      blob,
      width: canvas.width,
      height: canvas.height,
      bytes: blob.size,
      title: meta.title || "Full page",
      url: meta.url || "",
      filename: meta.filename || filenameFor(meta.title),
      capped: Boolean(meta.capped),
      reduced: Boolean(meta.reduced),
      mode: "full",
      created: Date.now(),
    };
    await saveShot(record);
    canvas = null;
    return publicResult(record);
  }

  throw new Error("Unknown stitch operation.");
}

function publicResult(record) {
  return {
    width: record.width,
    height: record.height,
    bytes: record.bytes,
    title: record.title,
    url: record.url,
    filename: record.filename,
    capped: record.capped,
    reduced: record.reduced,
    mode: record.mode,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "stitch") return;
  port.onMessage.addListener((message) => {
    handle(message).then(
      (result) => port.postMessage({ ok: true, result }),
      (err) => port.postMessage({ ok: false, error: err?.message || String(err) }),
    );
  });
});
