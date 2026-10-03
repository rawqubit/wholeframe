/** Plan scroll slices so each destination pixel is covered exactly once. */

export function planSlices(fullHeight, viewportHeight) {
  const slices = [];
  const total = Number(fullHeight);
  const vh = Number(viewportHeight);
  if (!Number.isFinite(total) || !Number.isFinite(vh) || total <= 0 || vh <= 0) {
    return slices;
  }
  const view = Math.min(vh, total);
  let dest = 0;
  let guard = 0;
  while (dest < total - 0.5 && guard++ < 10000) {
    const maxScroll = Math.max(0, total - view);
    const scrollTarget = Math.min(dest, maxScroll);
    const srcOffset = dest - scrollTarget;
    const drawHeight = Math.min(view - srcOffset, total - dest);
    if (drawHeight <= 0.5) break;
    slices.push({ scrollTarget, srcOffset, drawHeight, dest });
    dest += drawHeight;
  }
  return slices;
}

const MAX_DIM = 16384;
const MAX_AREA = 48_000_000;

/** Fit a full-page bitmap under Chrome canvas limits. */
export function outputSize(cssWidth, cssHeight, deviceScale) {
  const cssW = Math.max(1, Number(cssWidth) || 1);
  const cssH = Math.max(1, Number(cssHeight) || 1);
  const dpr = Math.max(1, Math.min(Number(deviceScale) || 1, 2));
  let width = cssW * dpr;
  let height = cssH * dpr;
  const dimLimit = Math.max(width / MAX_DIM, height / MAX_DIM, 1);
  width /= dimLimit;
  height /= dimLimit;
  const area = width * height;
  if (area > MAX_AREA) {
    const factor = Math.sqrt(MAX_AREA / area);
    width *= factor;
    height *= factor;
  }
  const outW = Math.max(1, Math.floor(width));
  const outH = Math.max(1, Math.floor(height));
  return {
    width: outW,
    height: outH,
    reduced: outH < Math.floor(cssH * dpr) - 1 || outW < Math.floor(cssW * dpr) - 1,
  };
}

export function filenameFor(title, date = new Date()) {
  const slug = String(title || "page")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "page";
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") + "-" + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
  return `wholeframe-${slug}-${stamp}.png`;
}
