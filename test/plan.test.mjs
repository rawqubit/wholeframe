import assert from "node:assert/strict";
import test from "node:test";
import { filenameFor, outputSize, planSlices } from "../plan.js";

test("covers a page exactly once", () => {
  const slices = planSlices(2500, 800);
  assert.equal(slices[0].scrollTarget, 0);
  assert.equal(slices[0].drawHeight, 800);
  const covered = slices.reduce((sum, slice) => sum + slice.drawHeight, 0);
  assert.equal(covered, 2500);
  for (let i = 1; i < slices.length; i++) {
    assert.equal(slices[i].dest, slices[i - 1].dest + slices[i - 1].drawHeight);
  }
  const last = slices[slices.length - 1];
  assert.ok(last.srcOffset > 0, "last slice should crop overlap instead of repeating");
  assert.equal(last.dest + last.drawHeight, 2500);
});

test("short pages are a single slice", () => {
  const slices = planSlices(500, 900);
  assert.equal(slices.length, 1);
  assert.equal(slices[0].drawHeight, 500);
  assert.equal(slices[0].scrollTarget, 0);
});

test("rejects empty input", () => {
  assert.deepEqual(planSlices(0, 800), []);
  assert.deepEqual(planSlices(800, 0), []);
});

test("scales huge pages under the canvas cap", () => {
  const sized = outputSize(1400, 80000, 2);
  assert.ok(sized.width <= 16384);
  assert.ok(sized.height <= 16384);
  assert.ok(sized.width * sized.height <= 48_000_000);
  assert.equal(sized.reduced, true);
});

test("keeps a normal screenshot at device scale", () => {
  const sized = outputSize(1200, 4000, 2);
  assert.equal(sized.width, 2400);
  assert.equal(sized.height, 8000);
  assert.equal(sized.reduced, false);
});

test("builds a safe filename", () => {
  const name = filenameFor("Hello / World!!!", new Date(2026, 3, 5, 9, 8, 7));
  assert.equal(name, "wholeframe-hello-world-20260405-090807.png");
});
