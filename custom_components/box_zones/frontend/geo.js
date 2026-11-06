/* Box Zones geometry. Pure functions, no DOM; the same maths as geometry.py.
 *
 * A box: {lat, lon, width_m, height_m, rotation_deg}. Local frame: x along the
 * width, y along the height, metres from the centre. Rotation is clockwise on a
 * north-up map; 0 means the width runs east-west.
 */
export const M_PER_DEG = 111320;
export const MIN_SIZE_M = 2;
export const MAX_SIZE_M = 50000;
const EDGE_MARGIN_M = 1e-6;

const rad = (a) => (a * Math.PI) / 180;
const deg = (a) => (a * 180) / Math.PI;
const round2 = (v) => Math.round(v * 100) / 100;

export function normDeg(d) {
  const r = ((d % 360) + 360) % 360;
  return r >= 360 ? 0 : r;
}

export function localToGeo(z, x, y) {
  const a = rad(z.rotation_deg);
  const east = x * Math.cos(a) + y * Math.sin(a);
  const north = -x * Math.sin(a) + y * Math.cos(a);
  return { lat: z.lat + north / M_PER_DEG, lon: z.lon + east / (M_PER_DEG * Math.cos(rad(z.lat))) };
}

export function geoToLocal(z, lat, lon) {
  const e = (lon - z.lon) * M_PER_DEG * Math.cos(rad(z.lat));
  const n = (lat - z.lat) * M_PER_DEG;
  const a = rad(z.rotation_deg);
  return { x: e * Math.cos(a) - n * Math.sin(a), y: e * Math.sin(a) + n * Math.cos(a) };
}

/** The four corners: top-left, top-right, bottom-right, bottom-left (in the box's own frame). */
export function corners(z) {
  const w = z.width_m / 2, h = z.height_m / 2;
  return [localToGeo(z, -w, h), localToGeo(z, w, h), localToGeo(z, w, -h), localToGeo(z, -w, -h)];
}

export function contains(z, lat, lon) {
  const p = geoToLocal(z, lat, lon);
  return Math.abs(p.x) <= z.width_m / 2 + EDGE_MARGIN_M && Math.abs(p.y) <= z.height_m / 2 + EDGE_MARGIN_M;
}

/** The box a point is in; when boxes overlap the smallest wins (like the entities). */
export function findZone(zones, lat, lon) {
  let best = null;
  for (const z of zones) {
    if (contains(z, lat, lon) && (!best || z.width_m * z.height_m < best.width_m * best.height_m)) best = z;
  }
  return best;
}

/** Outline with `perEdge` points per side, so big boxes follow the straight local-plane edges. */
export function outline(z, perEdge = 8) {
  const w = z.width_m / 2, h = z.height_m / 2;
  const cs = [[-w, h], [w, h], [w, -h], [-w, -h]];
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = cs[i], [x1, y1] = cs[(i + 1) % 4];
    for (let k = 0; k < perEdge; k++) {
      const t = k / perEdge;
      pts.push(localToGeo(z, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t));
    }
  }
  return pts;
}

/** Where each resize handle sits, as signs of the half width/height. */
export const HANDLES = {
  nw: [-1, 1], n: [0, 1], ne: [1, 1], e: [1, 0], se: [1, -1], s: [0, -1], sw: [-1, -1], w: [-1, 0],
};

function resizeAxis(size, s, pos) {
  const fixed = (-s * size) / 2; // the opposite side stays where it is
  const len = round2(Math.min(MAX_SIZE_M, Math.max(MIN_SIZE_M, s * (pos - fixed))));
  return { len, mid: fixed + (s * len) / 2 };
}

/** Drag resize handle `h` (n, ne, e, ...) to lat/lon; the opposite side or corner stays put. */
export function resize(base, h, lat, lon) {
  const pos = geoToLocal(base, lat, lon);
  let w = base.width_m, ht = base.height_m, dx = 0, dy = 0;
  if (h.includes("e") || h.includes("w")) {
    const r = resizeAxis(base.width_m, h.includes("e") ? 1 : -1, pos.x);
    w = r.len; dx = r.mid;
  }
  if (h.includes("n") || h.includes("s")) {
    const r = resizeAxis(base.height_m, h.includes("n") ? 1 : -1, pos.y);
    ht = r.len; dy = r.mid;
  }
  const c = localToGeo(base, dx, dy);
  return { ...base, lat: c.lat, lon: c.lon, width_m: w, height_m: ht };
}

/** The rotation that points the box's top side at lat/lon, in whole degrees. */
export function rotationTo(base, lat, lon) {
  const e = (lon - base.lon) * M_PER_DEG * Math.cos(rad(base.lat));
  const n = (lat - base.lat) * M_PER_DEG;
  return normDeg(Math.round(deg(Math.atan2(e, n))));
}

/** Screen position of the rotate handle: `offset` px beyond the top edge's midpoint. */
export function rotateHandlePx(center, topMid, rotationDeg, offset = 36) {
  let dx = topMid.x - center.x, dy = topMid.y - center.y;
  let len = Math.hypot(dx, dy);
  if (len < 1) { dx = Math.sin(rad(rotationDeg)); dy = -Math.cos(rad(rotationDeg)); len = 1; }
  return { x: topMid.x + (dx / len) * offset, y: topMid.y + (dy / len) * offset };
}

/** A round, friendly number of metres. */
export function niceMetres(m) {
  if (m < 20) return Math.max(MIN_SIZE_M, Math.round(m));
  if (m < 200) return Math.round(m / 5) * 5;
  if (m < 2000) return Math.round(m / 50) * 50;
  return Math.round(m / 500) * 500;
}

export function formatSize(z) {
  const f = (v) => (v >= 1000 ? `${round2(v / 1000)} km` : `${Math.round(v)} m`);
  return `${f(z.width_m)} × ${f(z.height_m)}`;
}

export function newId() {
  return `box_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
