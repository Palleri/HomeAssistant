// Moving a box with a finger, in a real browser (issue #13). Needs Playwright with
// Chromium (`npm i -g playwright && npx playwright install chromium`); skipped without it.
//
// On a touch device Leaflet listens to the browser's own touch events, not pointer
// events, so stopping `pointerdown` alone left Leaflet panning the map under the box.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let playwright = null;
try { playwright = createRequire(import.meta.url)("playwright"); } catch { /* skipped below */ }

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const PAGE = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%} box-zones-panel{display:block;height:100%}</style>
<script>customElements.define("ha-menu-button", class extends HTMLElement {});</script>
<script type=module>
import "/custom_components/box_zones/frontend/box-zones-panel.js";
const d = 0.0005;
const zones = [
  { id: "rectangle", name: "Rect", shape: "rectangle", lat: 52.5, lon: 13.4, width_m: 100, height_m: 60, rotation_deg: 0 },
  { id: "polygon", name: "Poly", shape: "polygon", points: [[52.5 - d, 13.4 - d], [52.5 - d, 13.4 + d], [52.5 + d, 13.4 + d], [52.5 + d, 13.4 - d]] },
];
const p = document.createElement("box-zones-panel");
p.narrow = true;
document.body.append(p);
p.hass = { config: { latitude: 52.5, longitude: 13.4 }, states: {}, themes: {}, callWS: async () => ({ zones, trackers: [] }) };
window.panel = p;
</script>`;

function serve() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(PAGE); }
    const f = path.join(ROOT, u.pathname);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Open box `id`, drag a finger from its middle, and say whether the map and the box moved. */
async function dragInside(browser, port, id) {
  const ctx = await browser.newContext({ ...playwright.devices["Pixel 7"] });
  try {
    const page = await ctx.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 404 })); // no map tiles
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.panel && window.panel._map && window.panel._mode.view === "list");
    await page.evaluate((id) => window.panel._edit(id), id);
    await page.waitForTimeout(400); // opening a box zooms to it
    const before = await page.evaluate(() => {
      const P = window.panel;
      const m = P._map, d = P._mode.draft;
      const mid = d.points
        ? [d.points.reduce((s, q) => s + q[0], 0) / d.points.length, d.points.reduce((s, q) => s + q[1], 0) / d.points.length]
        : [d.lat, d.lon];
      const pt = m.latLngToContainerPoint(mid), r = P._mapEl.getBoundingClientRect();
      return { x: r.left + pt.x, y: r.top + pt.y, center: m.getCenter(), draft: JSON.stringify(d) };
    });
    // Real touches (touch events and pointer events both), as a phone sends them.
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
    await touch("touchStart", before.x, before.y);
    for (let i = 1; i <= 10; i++) await touch("touchMove", before.x + 6 * i, before.y + 4 * i);
    await touch("touchEnd");
    const after = await page.evaluate(() => ({ center: window.panel._map.getCenter(), draft: JSON.stringify(window.panel._mode.draft) }));
    return {
      mapMoved: after.center.lat !== before.center.lat || after.center.lng !== before.center.lng,
      boxMoved: after.draft !== before.draft,
    };
  } finally {
    await ctx.close();
  }
}

test("a finger dragged inside a box moves the box and not the map", { skip: !playwright && "Playwright is not installed" }, async (t) => {
  const server = await serve();
  const browser = await playwright.chromium.launch();
  try {
    for (const id of ["rectangle", "polygon"]) {
      await t.test(id, async () => {
        const r = await dragInside(browser, server.address().port, id);
        assert.deepEqual(r, { mapMoved: false, boxMoved: true });
      });
    }
  } finally {
    await browser.close();
    server.close();
  }
});
