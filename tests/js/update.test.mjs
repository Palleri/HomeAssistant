// A page left open across an update (the Home Assistant app on a phone keeps it for
// days) keeps running the old panel code even after Home Assistant restarts: the
// browser has already defined <box-zones-panel>. The panel must say so and offer a
// reload. Needs Playwright with Chromium; skipped without it.
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

const TYPES = { ".js": "text/javascript", ".css": "text/css" };
// The page has loaded the panel code of `loaded`; Home Assistant now runs `running`.
const page = (loaded, running) => `<!doctype html>
<script>customElements.define("ha-menu-button", class extends HTMLElement {});</script>
<script type=module>
import "/custom_components/box_zones/frontend/box-zones-panel.js?v=${loaded}";
const p = document.createElement("box-zones-panel");
p.panel = { config: { version: "${running}" } };
document.body.append(p);
p.hass = { config: {}, states: {}, themes: {}, callWS: async () => ({ zones: [], trackers: [] }) };
window.panel = p;
</script>`;

function serve() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(page(u.searchParams.get("loaded"), u.searchParams.get("running")));
    }
    const f = path.join(ROOT, u.pathname);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("an open page running older panel code than Home Assistant offers a reload", { skip: !playwright && "Playwright is not installed" }, async (t) => {
  const browser = await playwright.chromium.launch();
  const server = await serve();
  const { port } = server.address();
  t.after(async () => { await browser.close(); server.close(); });
  const banner = async (loaded, running) => {
    const pg = await browser.newPage();
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 404 }));
    await pg.goto(`http://127.0.0.1:${port}/?loaded=${loaded}&running=${running}`);
    await pg.waitForFunction(() => window.panel && window.panel._mode.view === "list");
    const b = pg.locator("box-zones-panel .zb-update");
    const shown = await b.isVisible();
    const text = shown ? await b.innerText() : "";
    const reloads = shown && await b.locator("button", { hasText: "Reload" }).count() === 1;
    await pg.close();
    return { shown, text, reloads };
  };
  const stale = await banner("0.4.0", "0.4.1");
  assert.equal(stale.shown, true);
  assert.match(stale.text, /0\.4\.1/);
  assert.equal(stale.reloads, true);
  assert.equal((await banner("0.4.1", "0.4.1")).shown, false);
});
