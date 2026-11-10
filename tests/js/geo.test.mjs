// node --test tests/js/
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as G from "../../custom_components/box_zones/frontend/geo.js";

const BOX = { lat: 52.5163, lon: 13.3777, width_m: 100, height_m: 40, rotation_deg: 30 };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const NORTH = { ...BOX, rotation_deg: 0 };
/** [lat, lon] x metres east and y metres north of BOX's centre. */
const at = (x, y) => { const p = G.localToGeo(NORTH, x, y); return [p.lat, p.lon]; };
const polygon = (...xy) => ({ id: "p", name: "Garden", shape: "polygon", points: xy.map(([x, y]) => at(x, y)) });
// An L, 40 m × 40 m with the north-east quarter (the notch) cut out, and a U whose middle is in its notch.
const ELL = polygon([-20, -20], [20, -20], [20, 0], [0, 0], [0, 20], [-20, 20]);
const YOU = polygon([-30, -20], [30, -20], [30, 20], [10, 20], [10, -10], [-10, -10], [-10, 20], [-30, 20]);

test("local and geo coordinates round-trip", () => {
  const p = G.localToGeo(BOX, 12, -7);
  const back = G.geoToLocal(BOX, p.lat, p.lon);
  close(back.x, 12); close(back.y, -7);
});

test("resizing a corner keeps the opposite corner in place", () => {
  const sw = G.localToGeo(BOX, -50, -20);
  const target = G.localToGeo(BOX, 80, 40); // drag NE corner out
  const r = G.resize(BOX, "ne", target.lat, target.lon);
  close(r.width_m, 130, 0.01); close(r.height_m, 60, 0.01);
  const sw2 = G.localToGeo(r, -r.width_m / 2, -r.height_m / 2);
  close(sw2.lat, sw.lat, 1e-9); close(sw2.lon, sw.lon, 1e-9);
});

test("resizing a side only changes one dimension and never goes below the minimum", () => {
  const p = G.localToGeo(BOX, 0, -100);
  const r = G.resize(BOX, "n", p.lat, p.lon); // dragged past the bottom
  assert.equal(r.width_m, 100);
  assert.equal(r.height_m, G.MIN_SIZE_M);
});

test("rotation handle points the top side at the pointer", () => {
  const east = G.localToGeo({ ...BOX, rotation_deg: 0 }, 50, 0);
  assert.equal(G.rotationTo(BOX, east.lat, east.lon), 90);
});

test("smallest box wins, like the entities", () => {
  const big = { ...BOX, id: "big", width_m: 1000, height_m: 1000 };
  const small = { ...BOX, id: "small" };
  assert.equal(G.findZone([big, small], BOX.lat, BOX.lon).id, "small");
});

test("JS and Python agree on inside/outside, area and label point", () => {
  const pts = [];
  for (let i = 0; i < 400; i++) {
    const p = G.localToGeo(BOX, (Math.random() - 0.5) * 140, (Math.random() - 0.5) * 70);
    pts.push([p.lat, p.lon]);
  }
  // Points on the polygons' sides and corners too.
  for (const poly of [ELL, YOU]) {
    poly.points.forEach((a, i) => {
      const b = poly.points[(i + 1) % poly.points.length];
      pts.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    });
  }
  const boxes = [BOX, { ...BOX, shape: "rectangle", width_m: 7.5, height_m: 1234.25 }, ELL, YOU];
  const py = process.env.PYTHON || "python3";
  const out = execFileSync(py, ["-c", `
import json, sys
sys.path.insert(0, "custom_components/box_zones")
from geometry import area_m2, contains, label_point
boxes, pts = json.load(sys.stdin)
print(json.dumps([
    {"inside": [contains(box, lat, lon) for lat, lon in pts], "area": area_m2(box), "label": label_point(box)}
    for box in boxes
]))
`], { input: JSON.stringify([boxes, pts]) });
  const want = JSON.parse(out);
  boxes.forEach((box, b) => {
    pts.forEach(([lat, lon], i) => assert.equal(G.contains(box, lat, lon), want[b].inside[i], `box ${b} point ${i}`));
    close(G.areaM2(box), want[b].area);
    const lp = G.labelPoint(box);
    close(lp.lat, want[b].label[0], 1e-12); close(lp.lon, want[b].label[1], 1e-12);
  });
  // The concave polygons really do have points inside and outside among the samples.
  for (const b of [2, 3]) assert.ok(want[b].inside.includes(true) && want[b].inside.includes(false));
});

test("inside test for polygons: convex, concave, on a side, at a corner", () => {
  const square = polygon([-20, -20], [20, -20], [20, 20], [-20, 20]);
  assert.ok(G.contains(square, ...at(0, 0)));
  assert.ok(!G.contains(square, ...at(20.5, 0)));
  assert.ok(G.contains(ELL, ...at(-10, 10)) && G.contains(ELL, ...at(10, -10)));
  assert.ok(!G.contains(ELL, ...at(10, 10))); // the notch
  ELL.points.forEach((a, i) => {
    const b = ELL.points[(i + 1) % ELL.points.length];
    assert.ok(G.contains(ELL, ...a), `corner ${i}`);
    assert.ok(G.contains(ELL, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2), `side ${i}`);
  });
});

test("polygon area, label point, size text and corners for fitting the map", () => {
  close(G.areaM2(ELL), 1200, 0.1);
  close(G.areaM2({ ...ELL, points: [...ELL.points].reverse() }), G.areaM2(ELL));
  for (const poly of [ELL, YOU]) {
    const lp = G.labelPoint(poly);
    assert.ok(G.contains(poly, lp.lat, lp.lon));
  }
  const lp = G.labelPoint(YOU); // the middle is in the notch: the label goes into an arm
  assert.ok(!G.contains(YOU, ...at(0, 0)) && Math.abs(G.geoToLocal(NORTH, lp.lat, lp.lon).x) > 10);
  assert.equal(G.formatSize(ELL), "1 200 m² · 6 corners");
  assert.equal(G.formatSize(BOX), "100 m × 40 m");
  assert.equal(G.formatArea(1240.4), "1 240 m²");
  assert.equal(G.formatArea(2_500_000), "2.5 km²");
  const [[s, w], [n, e]] = G.bounds([ELL]);
  close(s, at(0, -20)[0]); close(n, at(0, 20)[0]); close(w, at(-20, 0)[1]); close(e, at(20, 0)[1]);
});

test("polygon outline follows every side and is subdivided like a rectangle's", () => {
  const ring = G.outline(ELL, 4);
  assert.equal(ring.length, 6 * 4);
  ELL.points.forEach(([lat, lon], i) => { close(ring[i * 4].lat, lat, 1e-12); close(ring[i * 4].lon, lon, 1e-12); });
  for (const p of ring) assert.ok(G.contains(ELL, p.lat, p.lon));
});

test("smallest area wins between a polygon and a rectangle", () => {
  assert.equal(G.findZone([BOX, ELL], ...at(-10, -10)).id, "p");
  assert.equal(G.findZone([BOX, ELL], ...at(10, 10)), BOX); // in the L's notch: only the rectangle
});

test("selfIntersects finds crossing, touching and repeated corners", () => {
  assert.ok(!G.selfIntersects(ELL.points));
  assert.ok(!G.selfIntersects(YOU.points));
  assert.ok(G.selfIntersects([at(0, 0), at(10, 10), at(10, 0), at(0, 10)])); // bow tie
  assert.ok(G.selfIntersects([at(0, 0), at(10, 0), at(10, 10), at(0, 0)])); // repeated corner
  assert.ok(G.selfIntersects([at(0, 0), at(20, 0), at(10, 0), at(10, 10)])); // folds back
  assert.ok(G.selfIntersects([at(0, 0), at(20, 0), at(20, 20), at(10, 0), at(0, 20)])); // corner on a side
});

test("a box without a shape is a rectangle", () => {
  assert.equal(G.shapeOf(BOX), G.RECTANGLE);
  assert.equal(G.shapeOf({ ...BOX, shape: "rectangle" }), "rectangle");
});

test("area and label point of a rectangle", () => {
  assert.equal(G.areaM2(BOX), 4000);
  assert.deepEqual(G.labelPoint(BOX), { lat: BOX.lat, lon: BOX.lon });
  const lp = G.labelPoint(BOX);
  assert.ok(G.contains(BOX, lp.lat, lp.lon));
});

test("smallest area wins whatever the proportions", () => {
  const long = { ...BOX, id: "long", width_m: 1000, height_m: 3 }; // 3000 m²: wider but smaller
  assert.equal(G.findZone([BOX, long], BOX.lat, BOX.lon).id, "long");
});

test("bounds span every box's outline and extra points", () => {
  const b = G.bounds([BOX], [{ lat: BOX.lat + 1, lon: BOX.lon }]);
  const [[s, w], [n, e]] = b;
  const cs = G.corners(BOX);
  close(s, Math.min(...cs.map((c) => c.lat)));
  close(w, Math.min(...cs.map((c) => c.lon)));
  close(e, Math.max(...cs.map((c) => c.lon)));
  close(n, BOX.lat + 1);
  const [[s2, w2], [n2, e2]] = G.bounds([BOX]);
  for (const p of G.outline(BOX)) {
    assert.ok(p.lat >= s2 - 1e-12 && p.lat <= n2 + 1e-12 && p.lon >= w2 - 1e-12 && p.lon <= e2 + 1e-12);
  }
  assert.equal(G.bounds([]), null);
});

test("an unknown shape is an error, not a silent miss", () => {
  assert.throws(() => G.contains({ ...BOX, shape: "blob" }, BOX.lat, BOX.lon));
});

test("corners are half the size away from the centre", () => {
  const [tl, , br] = G.corners({ ...BOX, rotation_deg: 0 });
  const a = G.geoToLocal(BOX, tl.lat, tl.lon);
  const b = G.geoToLocal(BOX, br.lat, br.lon);
  close(Math.hypot(a.x, a.y), Math.hypot(50, 20)); close(Math.hypot(b.x, b.y), Math.hypot(50, 20));
});

test("turning is smooth: 0.1° steps, no jump, optional snapping", () => {
  assert.equal(G.turnBy(30, 0.04), 30);
  assert.equal(G.turnBy(30, 0.26), 30.3);
  assert.equal(G.turnBy(350, 15), 5);
  assert.equal(G.turnBy(30, -40), 350);
  assert.equal(G.turnBy(30, 9, 15), 45);
  assert.equal(G.turnBy(30, 6, 15), 30);
});

test("edge distance and inside test in screen pixels", () => {
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
  assert.equal(G.distToSegment({ x: 50, y: -8 }, sq[0], sq[1]), 8);
  assert.equal(G.distToSegment({ x: 130, y: 0 }, sq[0], sq[1]), 30);
  assert.ok(G.pointInPolygon({ x: 50, y: 25 }, sq));
  assert.ok(!G.pointInPolygon({ x: 150, y: 25 }, sq));
});

test("a duplicate gets the next free name", () => {
  assert.equal(G.nextName("Parking", ["Parking"]), "Parking 2");
  assert.equal(G.nextName("Parking", ["Parking", "Parking 2"]), "Parking 3");
  assert.equal(G.nextName("Spot 2", ["Spot 2", "Spot 3"]), "Spot 4");
});

// ------------------------------------------------------- editing a polygon
const SQUARE = [at(0, 0), at(10, 0), at(10, 10), at(0, 10)];
const copy = (pts) => pts.map((p) => [...p]);
const poly = (points) => ({ shape: "polygon", points });

test("insertCorner adds a corner on the chosen side and leaves the input alone", () => {
  const before = copy(SQUARE);
  const mid = G.sideMidpoints(SQUARE)[1]; // the east side, corners 1 -> 2
  const p = G.insertCorner(SQUARE, 1, mid);
  assert.equal(p.length, 5);
  assert.deepEqual(p[2], mid);
  assert.deepEqual(p.filter((_, i) => i !== 2), SQUARE);
  assert.deepEqual(SQUARE, before);
  // Pulling the new corner outwards keeps a valid outline with more area.
  const out = G.moveCorner(p, 2, at(20, 5));
  assert.ok(!G.selfIntersects(out));
  assert.ok(G.areaM2(poly(out)) > G.areaM2(poly(SQUARE)));
  // The last side runs back to the first corner.
  assert.deepEqual(G.insertCorner(SQUARE, 3, at(-1, 5)).at(-1), at(-1, 5));
  assert.equal(G.insertCorner(SQUARE, 4, at(-1, 5)), null);
});

test("insertCorner stops at the maximum number of corners", () => {
  const many = Array.from({ length: G.MAX_CORNERS }, (_, i) => {
    const a = (2 * Math.PI * i) / G.MAX_CORNERS;
    return at(100 * Math.cos(a), 100 * Math.sin(a));
  });
  assert.equal(G.insertCorner(many, 0, at(0, 0)), null);
  assert.equal(G.insertCorner(many.slice(1), 0, at(0, 0)).length, G.MAX_CORNERS);
});

test("removeCorner removes one corner but never goes below 3", () => {
  const five = G.insertCorner(SQUARE, 0, at(5, -3));
  const four = G.removeCorner(five, 1);
  assert.deepEqual(four, SQUARE);
  const three = G.removeCorner(four, 0);
  assert.deepEqual(three, SQUARE.slice(1));
  assert.equal(G.removeCorner(three, 0), null);
  assert.equal(G.removeCorner(four, 7), null);
  assert.equal(five.length, 5); // the input is unchanged
});

test("side midpoints sit halfway along each side", () => {
  const mids = G.sideMidpoints(SQUARE);
  const want = [at(5, 0), at(10, 5), at(5, 10), at(0, 5)];
  assert.equal(mids.length, 4);
  mids.forEach((m, i) => { close(m[0], want[i][0], 1e-9); close(m[1], want[i][1], 1e-9); });
});

test("dragging a corner across the outline makes it cross itself", () => {
  assert.ok(!G.selfIntersects(SQUARE));
  assert.ok(G.selfIntersects(G.moveCorner(SQUARE, 2, at(5, -5)))); // pulled across the far side
  assert.ok(G.selfIntersects(G.moveCorner(SQUARE, 2, SQUARE[0]))); // onto another corner
  assert.ok(!G.selfIntersects(G.moveCorner(SQUARE, 2, at(4, 4)))); // a dent (concave) is fine
});

test("shiftPoints moves the whole polygon without changing its area", () => {
  const moved = G.shiftPoints(ELL.points, 0.0001, -0.0002);
  close(G.areaM2(poly(moved)), G.areaM2(ELL), 0.01);
  close(moved[3][0] - ELL.points[3][0], 0.0001, 1e-12);
  close(moved[3][1] - ELL.points[3][1], -0.0002, 1e-12);
});

test("onOrInside counts the inside and a band along the sides", () => {
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  assert.ok(G.onOrInside({ x: 50, y: 50 }, sq, 10));
  assert.ok(G.onOrInside({ x: 105, y: 50 }, sq, 10));
  assert.ok(!G.onOrInside({ x: 115, y: 50 }, sq, 10));
});

test("outlineProblem refuses exactly what the server refuses, with its message", () => {
  const lon = (p, d) => [p[0], p[1] + d];
  const big = (km) => { const half = (km * 1000) / 2; return [at(-half, 0), at(half, 0), at(0, 30)]; };
  // A corner 4 mm north of a side: fine as drawn, but on the side once rounded to 7 decimals like the server.
  const nearSide = [at(0, 0), at(20, 0), at(20, 20), [at(10, 0)[0] + 4e-8, at(10, 0)[1]], at(0, 20)];
  assert.ok(!G.selfIntersects(nearSide));
  const outlines = {
    ell: ELL.points,
    you: YOU.points,
    bowTie: [at(0, 0), at(10, 10), at(10, 0), at(0, 10)],
    nearSide,
    tiny: [at(0, 0), at(1.5, 0), at(1.5, 1.5), at(0, 1.5)], // 2.25 m²
    justEnough: [at(0, 0), at(2.1, 0), at(2.1, 2.1), at(0, 2.1)],
    tooWide: big(50.5),
    wideEnough: big(49.5),
    tooTall: [at(0, 0), at(30, 0), at(15, 50500)],
    twoCorners: [at(0, 0), at(10, 0)],
    offTheEdge: [[10, 179.9999], [10, 180.0001], [10.0001, 180]],
    pole: [[85.00001, 0], [84.9999, 0.001], [84.9999, -0.001]],
  };
  const py = process.env.PYTHON || "python3";
  const out = execFileSync(py, ["-c", `
import json, sys
sys.path.insert(0, "custom_components/box_zones")
from geometry import ZoneError, validate_zone
result = {}
for key, points in json.load(sys.stdin).items():
    try:
        validate_zone({"name": "x", "shape": "polygon", "points": points})
        result[key] = None
    except ZoneError as err:
        result[key] = str(err)
print(json.dumps(result))
`], { input: JSON.stringify(outlines) });
  const want = JSON.parse(out);
  for (const [key, points] of Object.entries(outlines)) assert.equal(G.outlineProblem(points), want[key], key);
  // Every kind of refusal is among the samples.
  assert.equal(want.nearSide, G.CROSSING_ERROR);
  assert.match(want.tiny, /at least 4 m²/);
  assert.match(want.tooWide, /at most 50 km/);
  assert.match(want.tooTall, /at most 50 km/);
  assert.match(want.offTheEdge, /Longitude/);
  assert.equal(want.ell, null);
  assert.equal(want.wideEnough, null);
  // An outline drawn on another copy of the world is saved on the main copy.
  assert.equal(G.outlineProblem(ELL.points.map((p) => lon(p, 360))), null);
});

test("wrapOutline and unwrapLon keep an outline in one piece near the antimeridian", () => {
  assert.equal(G.unwrapLon(-179.99, 179.99), 180.01);
  assert.equal(G.unwrapLon(181, -179.5), -179);
  assert.equal(G.unwrapLon(13.4, 13.3), 13.4);
  assert.equal(G.wrapOutline(ELL.points), ELL.points); // already on the main copy
  assert.deepEqual(G.wrapOutline([[1, 370], [1, 371], [2, 370]]), [[1, 10], [1, 11], [2, 10]]);
  assert.deepEqual(G.wrapOutline([[1, -350], [1, -349], [2, -350]]), [[1, 10], [1, 11], [2, 10]]);
  // Corners on both sides of the antimeridian: some stay outside -180..180, and that is refused.
  assert.deepEqual(G.wrapOutline([[1, 179.9], [1, 180.1], [2, 180]]), [[1, 179.9], [1, 180.1], [2, 180]]);
});
