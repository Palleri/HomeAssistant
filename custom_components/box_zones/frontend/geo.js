/* Box Zones geometry. Pure functions, no DOM; the same maths as geometry.py.
 *
 * Every box has a `shape`: "rectangle" or "polygon" (a box without `shape` is
 * a rectangle). Callers use the shape-neutral functions (contains, areaM2,
 * labelPoint, outline, boundsPoints, bounds, findZone, formatSize), which
 * dispatch on the shape, so a new shape only adds its own entry to SHAPES below.
 *
 * A rectangle: {lat, lon, width_m, height_m, rotation_deg}. Local frame: x along
 * the width, y along the height, metres from the centre. The turn (rotation_deg)
 * is clockwise on a north-up map; 0 means the width runs east-west.
 *
 * A polygon: {points: [[lat, lon], ...]}, its corners in order, the first not
 * repeated. Local plane: x metres east, y metres north of the middle of the
 * corners' lat/lon span.
 */
export const M_PER_DEG = 111320;
export const MIN_SIZE_M = 2;
export const MAX_SIZE_M = 50000;
export const MIN_AREA_M2 = MIN_SIZE_M * MIN_SIZE_M;
export const MIN_CORNERS = 3;
export const MAX_CORNERS = 100;
export const CROSSING_ERROR = "The outline crosses itself";
const EDGE_MARGIN_M = 1e-6;
export const RECTANGLE = "rectangle";
export const POLYGON = "polygon";

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

// ---------------------------------------------------------------- polygons
// The same maths as the polygon functions in geometry.py, step for step.

/** The polygon's local plane: {refLat, refLon, mLon, xy: [{x, y}]} for corners [[lat, lon], ...]. */
function plane(points) {
  let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
  for (const [lat, lon] of points) { s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lon); e = Math.max(e, lon); }
  const refLat = (s + n) / 2, refLon = (w + e) / 2;
  const mLon = M_PER_DEG * Math.cos(rad(refLat));
  return { refLat, refLon, mLon, xy: points.map(([lat, lon]) => ({ x: (lon - refLon) * mLon, y: (lat - refLat) * M_PER_DEG })) };
}

function signedArea(xy) {
  let s = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i], b = xy[(i + 1) % xy.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function polyContains(z, lat, lon) {
  const { refLat, refLon, mLon, xy } = plane(z.points);
  const p = { x: (lon - refLon) * mLon, y: (lat - refLat) * M_PER_DEG };
  for (let i = 0; i < xy.length; i++) {
    if (distToSegment(p, xy[i], xy[(i + 1) % xy.length]) <= EDGE_MARGIN_M) return true;
  }
  return pointInPolygon(p, xy);
}

/** Centroid when inside, else the middle of the widest inside stretch east-west through it. */
function labelXY(xy) {
  const n = xy.length, a = signedArea(xy);
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const p = xy[i], q = xy[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  cx /= 6 * a; cy /= 6 * a;
  if (pointInPolygon({ x: cx, y: cy }, xy)) return { x: cx, y: cy };
  const xs = [];
  for (let i = 0; i < n; i++) {
    const p = xy[i], q = xy[(i + 1) % n];
    if ((p.y > cy) !== (q.y > cy)) xs.push(p.x + ((cy - p.y) * (q.x - p.x)) / (q.y - p.y));
  }
  xs.sort((u, v) => u - v);
  let best = null;
  for (let k = 0; k + 1 < xs.length; k += 2) if (!best || xs[k + 1] - xs[k] > best[1] - best[0]) best = [xs[k], xs[k + 1]];
  return { x: (best[0] + best[1]) / 2, y: cy };
}

function polyLabelPoint(z) {
  const { refLat, refLon, mLon, xy } = plane(z.points);
  const p = labelXY(xy);
  return { lat: refLat + p.y / M_PER_DEG, lon: refLon + p.x / mLon };
}

function polyOutline(z, perEdge) {
  const { refLat, refLon, mLon, xy } = plane(z.points);
  const pts = [];
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i], b = xy[(i + 1) % xy.length];
    for (let k = 0; k < perEdge; k++) {
      const t = k / perEdge;
      pts.push({ lat: refLat + (a.y + (b.y - a.y) * t) / M_PER_DEG, lon: refLon + (a.x + (b.x - a.x) * t) / mLon });
    }
  }
  return pts;
}

const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const onSegment = (a, b, p) =>
  Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);

function segmentsTouch(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  return (o1 === 0 && onSegment(a, b, c)) || (o2 === 0 && onSegment(a, b, d))
    || (o3 === 0 && onSegment(c, d, a)) || (o4 === 0 && onSegment(c, d, b));
}

/** Does the outline ([[lat, lon], ...]) cross or touch itself, or repeat a corner? */
export function selfIntersects(points) {
  return ringSelfIntersects(plane(points).xy);
}

function ringSelfIntersects(xy) {
  const n = xy.length;
  if (new Set(xy.map((p) => `${p.x},${p.y}`)).size !== n) return true;
  for (let i = 0; i < n; i++) {
    const a = xy[i], b = xy[(i + 1) % n], c = xy[(i + 2) % n];
    // Neighbouring sides meet only at their shared corner, never doubling back along one line.
    if (orient(a, b, c) === 0 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) return true;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // the last side is next to the first
      if (segmentsTouch(a, b, xy[j], xy[(j + 1) % n])) return true;
    }
  }
  return false;
}

// ------------------------------------------- checking an outline before saving
// The same checks, in the same order and with the same messages, as
// _validate_polygon in geometry.py, so Save is only offered for outlines the
// server keeps.

/** Corners are stored to 7 decimals (about 1 cm), like geometry.py's CORNER_DECIMALS. */
export const CORNER_DECIMALS = 7;
// toFixed rounds the exact value of the number, like Python's round().
const roundCorner = (v) => Number(v.toFixed(CORNER_DECIMALS));

/** `lon` moved by whole turns to within 180° of `refLon`: a tap on another copy of the world, brought next to the outline. */
export function unwrapLon(lon, refLon) {
  return lon - 360 * Math.round((lon - refLon) / 360);
}

/**
 * The outline moved by whole turns of longitude so the middle of its longitudes
 * is within -180..180 (the copy of the world the server stores). An outline that
 * straddles the antimeridian keeps corners outside that range, which the server refuses.
 */
export function wrapOutline(points) {
  if (!points.length) return points;
  let w = Infinity, e = -Infinity;
  for (const [, lon] of points) { w = Math.min(w, lon); e = Math.max(e, lon); }
  const mid = (w + e) / 2;
  const turns = mid > 180 ? Math.ceil((mid - 180) / 360) : mid < -180 ? -Math.ceil((-180 - mid) / 360) : 0;
  return turns ? points.map(([lat, lon]) => [lat, lon - 360 * turns]) : points;
}

/** Why the server would refuse the outline as saved (after wrapOutline), or null when it is fine. */
export function outlineProblem(points) {
  const pts = wrapOutline(points);
  if (pts.length < MIN_CORNERS || pts.length > MAX_CORNERS) return `A polygon must have ${MIN_CORNERS} to ${MAX_CORNERS} corners`;
  const rounded = [];
  for (const [lat, lon] of pts) {
    if (!(lat >= -85 && lat <= 85)) return "Latitude must be between -85 and 85";
    if (!(lon >= -180 && lon <= 180)) return "Longitude must be between -180 and 180";
    rounded.push([roundCorner(lat), roundCorner(lon)]);
  }
  const { xy } = plane(rounded);
  const xs = xy.map((p) => p.x), ys = xy.map((p) => p.y);
  // "Across" like a rectangle: at most the largest width and height, east-west and north-south.
  if (Math.max(...xs) - Math.min(...xs) > MAX_SIZE_M || Math.max(...ys) - Math.min(...ys) > MAX_SIZE_M) {
    return `A polygon can be at most ${MAX_SIZE_M / 1000} km across`;
  }
  if (ringSelfIntersects(xy)) return CROSSING_ERROR;
  if (Math.abs(signedArea(xy)) < MIN_AREA_M2) return `A polygon must be at least ${MIN_AREA_M2} m²`;
  return null;
}

/** Per-shape maths. A new shape adds an entry with the same functions. */
const SHAPES = {
  [RECTANGLE]: {
    contains: rectContains,
    area: (z) => z.width_m * z.height_m,
    labelPoint: (z) => ({ lat: z.lat, lon: z.lon }),
    outline: rectOutline,
    boundsPoints: corners,
    sizeText: (z) => {
      const f = (v) => (v >= 1000 ? `${round2(v / 1000)} km` : `${Math.round(v)} m`);
      return `${f(z.width_m)} × ${f(z.height_m)}`;
    },
  },
  [POLYGON]: {
    contains: polyContains,
    area: (z) => Math.abs(signedArea(plane(z.points).xy)),
    labelPoint: polyLabelPoint,
    outline: polyOutline,
    boundsPoints: (z) => z.points.map(([lat, lon]) => ({ lat, lon })),
    sizeText: (z) => `${formatArea(areaM2(z))} · ${z.points.length} corners`,
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

/** Digits grouped in threes with spaces: 1240 -> "1 240". */
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** "1 240 m²", or "3.5 km²" from a square kilometre up. */
export function formatArea(m2) {
  return m2 >= 1e6 ? `${round2(m2 / 1e6)} km²` : `${grouped(Math.round(m2))} m²`;
}

/** The list row's size: "100 m × 40 m" for a rectangle, "1 240 m² · 7 corners" for a polygon. */
export function formatSize(z) {
  return shapeFns(z).sizeText(z);
}

export function newId() {
  return `box_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ------------------------------------------------------- editing a polygon
// Pure helpers for the polygon editor. Corners are [lat, lon] pairs; every helper
// returns a new array and never changes the one it was given (the editor's draft
// can share its array with the stored box).

/** The middle of each side, as [lat, lon]; side i runs from corner i to corner i + 1. */
export function sideMidpoints(points) {
  return points.map(([lat, lon], i) => {
    const [lat2, lon2] = points[(i + 1) % points.length];
    // The local plane is linear in lat/lon, so this is also the middle in metres.
    return [(lat + lat2) / 2, (lon + lon2) / 2];
  });
}

/** A new corner [lat, lon] on side `sideIndex` (between corners i and i + 1), or null at MAX_CORNERS. */
export function insertCorner(points, sideIndex, latlon) {
  if (points.length >= MAX_CORNERS || sideIndex < 0 || sideIndex >= points.length) return null;
  const next = points.slice();
  next.splice(sideIndex + 1, 0, [latlon[0], latlon[1]]);
  return next;
}

/** The outline without corner `index`, or null when that would leave fewer than MIN_CORNERS. */
export function removeCorner(points, index) {
  if (points.length <= MIN_CORNERS || index < 0 || index >= points.length) return null;
  return points.filter((_, i) => i !== index);
}

/** The outline with corner `index` at [lat, lon]. */
export function moveCorner(points, index, latlon) {
  return points.map((p, i) => (i === index ? [latlon[0], latlon[1]] : p));
}

/** Every corner shifted by dLat/dLon degrees (moving the whole polygon). */
export function shiftPoints(points, dLat, dLon) {
  return points.map(([lat, lon]) => [lat + dLat, lon + dLon]);
}

/** Is point p inside the outline pts ({x, y}, e.g. screen pixels) or within `tol` of a side? */
export function onOrInside(p, pts, tol) {
  for (let i = 0; i < pts.length; i++) if (distToSegment(p, pts[i], pts[(i + 1) % pts.length]) <= tol) return true;
  return pointInPolygon(p, pts);
}

// ------------------------------------------------- drawing a new polygon
// The drawing state is {points: [[lat, lon], ...], closed}. Every function returns a
// new state (or the same one when nothing changes); the page only does the taps.

export function startDrawing() {
  return { points: [], closed: false };
}

/** Add a corner at [lat, lon]; nothing happens once closed or at MAX_CORNERS. */
export function addCorner(dr, point) {
  if (dr.closed || dr.points.length >= MAX_CORNERS) return dr;
  return { points: [...dr.points, [point[0], point[1]]], closed: false };
}

/** Remove the last corner. On a closed outline this also opens it again. */
export function undoCorner(dr) {
  if (!dr.points.length) return dr;
  return { points: dr.points.slice(0, -1), closed: false };
}

export function canCloseDrawing(dr) {
  return !dr.closed && dr.points.length >= MIN_CORNERS;
}

/** Close the outline (Done, or a tap on the first corner); needs MIN_CORNERS corners. */
export function closeDrawing(dr) {
  return canCloseDrawing(dr) ? { ...dr, closed: true } : dr;
}

/** Save is possible once the outline is closed and the server would keep it (see outlineProblem). */
export function canSaveDrawing(dr) {
  return dr.closed && dr.points.length >= MIN_CORNERS && !outlineProblem(dr.points);
}

/** Did the pointer stay within `tolPx` between down and up ({x, y} screen points), so it was a tap, not a pan? */
export function isTap(down, up, tolPx) {
  return Math.hypot(up.x - down.x, up.y - down.y) <= tolPx;
}

/**
 * A tap while drawing, at `point` ([lat, lon]) and screen position `px`.
 * `cornersPx` are the corners' screen positions. Within `tolPx` of the first
 * corner (with enough corners) the tap closes the outline; on the last corner it
 * does nothing (a double tap places one corner); otherwise it adds a corner.
 */
export function tapDrawing(dr, point, px, cornersPx, tolPx) {
  if (dr.closed) return dr;
  const n = cornersPx.length;
  const near = (c) => Math.hypot(px.x - c.x, px.y - c.y) <= tolPx;
  if (canCloseDrawing(dr) && near(cornersPx[0])) return closeDrawing(dr);
  if (n && near(cornersPx[n - 1])) return dr;
  return addCorner(dr, point);
}
