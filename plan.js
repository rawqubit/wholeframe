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

/**
 * Chrome rejects tabs.captureVisibleTab above 2 calls per second, and the
 * window uses a strict greater-than check, so a gap of exactly 500ms or
 * 1000ms still fails the next call. Wait until the previous capture has
 * finished, then a little more than one second.
 */
export const CAPTURE_MIN_INTERVAL_MS = 1100;
export const CAPTURE_QUOTA_BACKOFF_MS = 1500;
export const CAPTURE_QUOTA_RETRIES = 4;

/** Milliseconds to wait so the next capture starts at or after `nextAllowedAt`. */
export function captureQuotaDelay(now, nextAllowedAt) {
  const wait = Number(nextAllowedAt) - Number(now);
  if (!Number.isFinite(wait) || wait <= 0) return 0;
  return wait;
}

export function nextCaptureSlot(now, interval = CAPTURE_MIN_INTERVAL_MS) {
  const t = Number(now);
  const step = Number(interval);
  if (!Number.isFinite(t)) return 0;
  if (!Number.isFinite(step) || step < 0) return t;
  return t + step;
}

export function isCaptureQuotaError(message) {
  return /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(String(message || ""));
}

/**
 * Chrome TimedLimit: `limit` tokens, refilled when a call arrives after the
 * window that started on the previous refill. Returns false if any call
 * would be rejected.
 */
export function captureScheduleFitsQuota(timestamps, limit = 2, windowMs = 1000) {
  let tokens = 0;
  let expiration = -Infinity;
  for (const raw of timestamps) {
    const t = Number(raw);
    if (!Number.isFinite(t)) return false;
    if (t > expiration) {
      tokens = limit;
      expiration = t + windowMs;
    }
    if (tokens <= 0) return false;
    tokens -= 1;
  }
  return true;
}

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
