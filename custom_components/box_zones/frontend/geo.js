/* Box Zones geometry. Pure functions, no DOM; the same maths as geometry.py.
 *
 * Every box has a `shape`; today only "rectangle" (a box without `shape` is a
 * rectangle). Callers use the shape-neutral functions (contains, areaM2,
 * labelPoint, outline, boundsPoints, bounds, findZone), which dispatch on the
 * shape, so a new shape only adds its own entry to SHAPES below.
 *
 * A rectangle: {lat, lon, width_m, height_m, rotation_deg}. Local frame: x along
 * the width, y along the height, metres from the centre. The turn (rotation_deg)
 * is clockwise on a north-up map; 0 means the width runs east-west.
 */
export const M_PER_DEG = 111320;
export const MIN_SIZE_M = 2;
export const MAX_SIZE_M = 50000;
const EDGE_MARGIN_M = 1e-6;
export const RECTANGLE = "rectangle";

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

/** The box's shape; a box without one is a rectangle. */
export function shapeOf(z) {
  return z.shape || RECTANGLE;
}

/** A rectangle's four corners: top-left, top-right, bottom-right, bottom-left (in its own frame). */
export function corners(z) {
  const w = z.width_m / 2, h = z.height_m / 2;
  return [localToGeo(z, -w, h), localToGeo(z, w, h), localToGeo(z, w, -h), localToGeo(z, -w, -h)];
}

function rectContains(z, lat, lon) {
  const p = geoToLocal(z, lat, lon);
  return Math.abs(p.x) <= z.width_m / 2 + EDGE_MARGIN_M && Math.abs(p.y) <= z.height_m / 2 + EDGE_MARGIN_M;
}

function rectOutline(z, perEdge) {
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

/** Per-shape maths. A new shape adds an entry with the same functions. */
const SHAPES = {
  [RECTANGLE]: {
    contains: rectContains,
    area: (z) => z.width_m * z.height_m,
    labelPoint: (z) => ({ lat: z.lat, lon: z.lon }),
    outline: rectOutline,
    boundsPoints: corners,
  },
};

function shapeFns(z) {
  const fns = SHAPES[shapeOf(z)];
  if (!fns) throw new Error(`Unknown shape: ${shapeOf(z)}`);
  return fns;
}

/** Is the point inside the box? Points on an edge count as inside. */
export function contains(z, lat, lon) {
  return shapeFns(z).contains(z, lat, lon);
}

/** The box's area in square metres (the same number as the entity's area_m2). */
export function areaM2(z) {
  return shapeFns(z).area(z);
}

/** A point inside the box where its name goes: the middle of a rectangle. */
export function labelPoint(z) {
  return shapeFns(z).labelPoint(z);
}

/** The drawable ring, with `perEdge` points per side so long sides follow the straight local-plane line. */
export function outline(z, perEdge = 8) {
  return shapeFns(z).outline(z, perEdge);
}

/** Points that span the box, for fitting the map to it. */
export function boundsPoints(z) {
  return shapeFns(z).boundsPoints(z);
}

/** [[south, west], [north, east]] around all the boxes (and any extra {lat, lon} points), or null if empty. */
export function bounds(zones, extra = []) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  const add = (p) => { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); };
  for (const z of zones) boundsPoints(z).forEach(add);
  extra.forEach(add);
  return s === Infinity ? null : [[s, w], [n, e]];
}

/** The box a point is in; when boxes overlap the smallest area wins (like the entities). */
export function findZone(zones, lat, lon) {
  let best = null, bestArea = Infinity;
  for (const z of zones) {
    if (!contains(z, lat, lon)) continue;
    const a = areaM2(z);
    if (a < bestArea) { best = z; bestArea = a; }
  }
  return best;
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

export const toDeg = deg;

/** Turn a rotation by `delta` degrees, to 0.1°. With `snap` (e.g. 15) it lands on multiples of it. */
export function turnBy(rotation, delta, snap = 0) {
  let r = rotation + delta;
  if (snap > 0) r = Math.round(r / snap) * snap;
  const n = Math.round(normDeg(r) * 10) / 10;
  return n >= 360 ? 0 : n;
}

/** Distance from point p to the segment a-b ({x, y} objects, e.g. screen pixels). */
export function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Is point p inside the polygon pts ({x, y} objects)? */
export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
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

/** "Parking" -> "Parking 2", "Spot 2" -> "Spot 3": the first name that isn't taken. */
export function nextName(name, taken) {
  const used = new Set(taken);
  const m = /^(.*?)\s+(\d+)$/.exec(name);
  const base = m ? m[1] : name;
  let n = m ? Number(m[2]) + 1 : 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
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
