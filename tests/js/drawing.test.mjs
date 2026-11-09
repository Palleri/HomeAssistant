// Drawing a new polygon: the pure state helpers in geo.js.
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../../custom_components/box_zones/frontend/geo.js";

const A = [52.5, 13.4], B = [52.5, 13.401], C = [52.501, 13.401], D = [52.501, 13.4];
const drawn = (...pts) => pts.reduce((dr, p) => G.addCorner(dr, p), G.startDrawing());

test("corners are added in order and the outline starts open", () => {
  const dr = drawn(A, B, C);
  assert.deepEqual(dr.points, [A, B, C]);
  assert.equal(dr.closed, false);
  assert.deepEqual(G.startDrawing(), { points: [], closed: false });
});

test("undo removes the last corner, and does nothing with no corners", () => {
  assert.deepEqual(G.undoCorner(drawn(A, B, C)).points, [A, B]);
  const empty = G.startDrawing();
  assert.equal(G.undoCorner(empty), empty);
});

test("closing needs at least 3 corners", () => {
  assert.equal(G.closeDrawing(drawn(A, B)).closed, false);
  assert.equal(G.canCloseDrawing(drawn(A, B)), false);
  assert.equal(G.closeDrawing(drawn(A, B, C)).closed, true);
});

test("save stays disabled until the outline is closed with at least 3 corners", () => {
  assert.equal(G.canSaveDrawing(G.startDrawing()), false);
  assert.equal(G.canSaveDrawing(drawn(A, B, C)), false); // not closed
  const closed = G.closeDrawing(drawn(A, B, C));
  assert.equal(G.canSaveDrawing(closed), true);
  // Undo on a closed outline opens it again, so Save is off again.
  const undone = G.undoCorner(closed);
  assert.deepEqual(undone, { points: [A, B], closed: false });
  assert.equal(G.canSaveDrawing(undone), false);
});

test("a closed outline takes no more corners and can't be closed twice", () => {
  const closed = G.closeDrawing(drawn(A, B, C));
  assert.equal(G.addCorner(closed, D), closed);
  assert.equal(G.canCloseDrawing(closed), false);
});

test("no more than MAX_CORNERS corners", () => {
  let dr = G.startDrawing();
  for (let i = 0; i < G.MAX_CORNERS + 5; i++) dr = G.addCorner(dr, [52.5 + i * 1e-4, 13.4 + (i % 2) * 1e-4]);
  assert.equal(dr.points.length, G.MAX_CORNERS);
});

test("a tap is a pointer that didn't move further than the tolerance", () => {
  assert.equal(G.isTap({ x: 10, y: 10 }, { x: 13, y: 14 }, 5), true);
  assert.equal(G.isTap({ x: 10, y: 10 }, { x: 30, y: 10 }, 5), false);
});

test("tapping the first corner closes the outline once there are 3 corners", () => {
  const px = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const dr = drawn(A, B, C);
  const closed = G.tapDrawing(dr, D, { x: 4, y: -3 }, px, 10);
  assert.equal(closed.closed, true);
  assert.deepEqual(closed.points, [A, B, C]);
  // Far from the first corner: a new corner.
  const more = G.tapDrawing(dr, D, { x: 0, y: 100 }, px, 10);
  assert.deepEqual(more.points, [A, B, C, D]);
  assert.equal(more.closed, false);
});

test("with fewer than 3 corners a tap near the first corner places a corner", () => {
  const dr = drawn(A, B);
  const next = G.tapDrawing(dr, C, { x: 50, y: 0 }, [{ x: 0, y: 0 }, { x: 200, y: 0 }], 60);
  assert.deepEqual(next.points, [A, B, C]);
});

test("a second tap on the last corner places nothing", () => {
  const dr = drawn(A, B);
  assert.equal(G.tapDrawing(dr, B, { x: 101, y: 1 }, [{ x: 0, y: 0 }, { x: 100, y: 0 }], 10), dr);
});

test("taps on a closed outline change nothing", () => {
  const closed = G.closeDrawing(drawn(A, B, C));
  assert.equal(G.tapDrawing(closed, D, { x: 50, y: 50 }, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 10), closed);
});

test("save stays disabled for a closed outline the server would refuse", () => {
  // A bow tie crosses itself.
  assert.equal(G.canSaveDrawing(G.closeDrawing(drawn(A, C, B, D))), false);
  // About 1.1 m × 1.1 m: under the 4 m² minimum.
  const tiny = G.closeDrawing(drawn(A, [A[0], A[1] + 0.000016], [A[0] + 0.00001, A[1] + 0.000016]));
  assert.equal(G.canSaveDrawing(tiny), false);
  assert.equal(G.canSaveDrawing(G.closeDrawing(drawn(A, B, C, D))), true);
});
