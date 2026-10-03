const shot = document.querySelector("#shot");
const meta = document.querySelector("#meta");
const note = document.querySelector("#note");
const empty = document.querySelector("#empty");
const pngBtn = document.querySelector("#png");
const jpegBtn = document.querySelector("#jpeg");
const copyBtn = document.querySelector("#copy");

let record = null;
let objectUrl = "";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("wholeframe", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("shots")) {
        req.result.createObjectStore("shots", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function load() {
  const database = await openDb();
  record = await new Promise((resolve, reject) => {
    const tx = database.transaction("shots", "readonly");
    const req = tx.objectStore("shots").get("latest");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  database.close();

  if (!record?.blob) {
    shot.hidden = true;
    empty.hidden = false;
    pngBtn.disabled = true;
    jpegBtn.disabled = true;
    copyBtn.disabled = true;
    meta.textContent = "Nothing captured yet";
    return;
  }

  objectUrl = URL.createObjectURL(record.blob);
  shot.src = objectUrl;
  shot.hidden = false;
  const kind = record.mode === "visible" ? "Visible area" : "Full page";
  meta.textContent = `${kind} | ${record.width} x ${record.height} | ${formatBytes(record.bytes)}`;
  meta.title = record.url || "";
  const notes = [];
  if (record.capped) notes.push("Stopped at 50,000 pixels so an endless page cannot freeze the browser.");
  if (record.reduced) notes.push("Scaled down so the image fits Chrome's canvas size limit.");
  if (record.url) notes.push(record.url);
  if (notes.length) {
    note.hidden = false;
    note.textContent = notes.join(" ");
  }
}

async function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 20000);
  }
}

pngBtn.addEventListener("click", () => {
  if (record?.blob) download(record.blob, record.filename || "wholeframe.png");
});

jpegBtn.addEventListener("click", async () => {
  if (!record?.blob) return;
  jpegBtn.disabled = true;
  try {
    const bmp = await createImageBitmap(record.blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const g = canvas.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    const name = (record.filename || "wholeframe.png").replace(/\.png$/i, ".jpg");
    await download(blob, name);
  } finally {
    jpegBtn.disabled = false;
  }
});

copyBtn.addEventListener("click", async () => {
  if (!record?.blob) return;
  const original = copyBtn.textContent;
  try {
    const png = record.blob.type === "image/png"
      ? record.blob
      : await (async () => {
        const bmp = await createImageBitmap(record.blob);
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        canvas.getContext("2d").drawImage(bmp, 0, 0);
        bmp.close();
        return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      })();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    copyBtn.textContent = "Copied";
  } catch {
    copyBtn.textContent = "Copy failed";
  }
  setTimeout(() => { copyBtn.textContent = original; }, 1600);
});

load().catch((err) => {
  meta.textContent = err?.message || "Could not open the screenshot.";
});
