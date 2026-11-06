// node --test tests/js/
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as G from "../../custom_components/box_zones/frontend/geo.js";

const BOX = { lat: 52.5163, lon: 13.3777, width_m: 100, height_m: 40, rotation_deg: 30 };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

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

test("JS and Python agree on inside/outside", () => {
  const pts = [];
  for (let i = 0; i < 400; i++) {
    const p = G.localToGeo(BOX, (Math.random() - 0.5) * 140, (Math.random() - 0.5) * 70);
    pts.push([p.lat, p.lon]);
  }
  const py = process.env.PYTHON || "python3";
  const out = execFileSync(py, ["-c", `
import json, sys
sys.path.insert(0, "custom_components/box_zones")
from geometry import contains
box, pts = json.load(sys.stdin)
print(json.dumps([contains(box, lat, lon) for lat, lon in pts]))
`], { input: JSON.stringify([BOX, pts]) });
  const want = JSON.parse(out);
  pts.forEach(([lat, lon], i) => assert.equal(G.contains(BOX, lat, lon), want[i], `point ${i}`));
});

test("corners are half the size away from the centre", () => {
  const [tl, , br] = G.corners({ ...BOX, rotation_deg: 0 });
  const a = G.geoToLocal(BOX, tl.lat, tl.lon);
  const b = G.geoToLocal(BOX, br.lat, br.lon);
  close(Math.hypot(a.x, a.y), Math.hypot(50, 20)); close(Math.hypot(b.x, b.y), Math.hypot(50, 20));
});
