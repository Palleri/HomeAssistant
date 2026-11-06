/* Box Zones page (sidebar panel).
 *
 * Left (or bottom on a phone): the list of boxes and followed trackers, or the
 * editor for one box. Right (or top): the map. A box can only be changed after
 * you open it, and nothing is stored until you press Save.
 */
const BASE = new URL("./", import.meta.url).href;
const VERSION = new URL(import.meta.url).searchParams.get("v") || "dev";
const V = `?v=${encodeURIComponent(VERSION)}`;

let G = null; // geo.js, loaded with the same cache-busting version
let leafletPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = (async () => {
      const previous = window.L;
      await loadScript(`${BASE}leaflet/leaflet.js${V}`);
      const L = window.L;
      // Give back whatever was there before, so we never clash with another card.
      if (previous && previous !== L) window.L = previous;
      return L;
    })();
  }
  return leafletPromise;
}

const TILES = {
  map: {
    label: "Map",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    darkFilter: true,
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Imagery &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics',
    darkFilter: false,
  },
};
const TILE_KEY = "box-zones-tiles";
// Past the tiles' own detail (19) the map just enlarges them, which is fine for drawing.
const MAX_ZOOM = 23;
// How close (screen pixels) to the box's edge a drag turns the box instead of moving it.
const EDGE_PX = { mouse: 10, touch: 20 };
const EDIT_COLOR = "#ff9800";
const DEVICE_COLOR = "#2e7d32";

const STATE_LABELS = { home: "Home", not_home: "Away", unavailable: "Unavailable", unknown: "Unknown" };
const stateLabel = (s) => (s == null ? "Not created yet" : STATE_LABELS[s] || s);

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

function readTileChoice() {
  try { return localStorage.getItem(TILE_KEY); } catch (_) { return null; }
}
function saveTileChoice(v) {
  try { localStorage.setItem(TILE_KEY, v); } catch (_) { /* private mode */ }
}

const ICON_ROTATE = "M16.89,15.5L18.31,16.89C19.21,15.73 19.76,14.39 19.93,13H17.91C17.77,13.87 17.43,14.72 16.89,15.5M13,17.9V19.92C14.39,19.75 15.74,19.21 16.9,18.31L15.46,16.87C14.71,17.41 13.87,17.76 13,17.9M19.93,11C19.76,9.61 19.21,8.27 18.31,7.11L16.89,8.53C17.43,9.28 17.77,10.13 17.91,11M15.55,5.55L11,1V4.07C7.06,4.56 4,7.92 4,12C4,16.08 7.05,19.44 11,19.93V17.91C8.16,17.43 6,14.97 6,12C6,9.03 8.16,6.57 11,6.09V10L15.55,5.55Z";
const svgUrl = (path, color) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='${color}' d='${path}'/></svg>`)}")`;

const CSS = `
/* Size to the window: some Home Assistant versions don't give panels a fixed height. */
:host { display: block; height: 100vh; height: 100dvh; background: var(--primary-background-color); color: var(--primary-text-color);
  font-family: var(--ha-font-family-body, Roboto, Noto, sans-serif); -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
.layout { display: flex; flex-direction: column; height: 100%; }
.toolbar { display: flex; align-items: center; gap: 4px; height: var(--header-height, 56px); padding: 0 12px; flex: none;
  background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff);
  border-bottom: var(--app-header-border-bottom, none); }
.toolbar .title { font-size: 20px; font-weight: 400; margin-left: 8px; }
.main { flex: 1; display: flex; min-height: 0; }
.side { width: 360px; flex: none; overflow-y: auto; background: var(--card-background-color, #fff);
  border-right: 1px solid var(--divider-color, #e0e0e0); }
.mapwrap { flex: 1; position: relative; min-width: 0; }
#map { position: absolute; inset: 0; background: var(--secondary-background-color, #e5e3df); }
:host([narrow]) .main { flex-direction: column-reverse; }
:host([narrow]) .side { width: auto; max-height: 50%; border-right: none; border-top: 1px solid var(--divider-color, #e0e0e0); }
:host([narrow]) .mapwrap { min-height: 50%; }

section { padding: 16px; }
section + section { border-top: 1px solid var(--divider-color, #e0e0e0); }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
h2 { font-size: 16px; font-weight: 500; margin: 0; }
p { margin: 0 0 12px; }
.hint { color: var(--secondary-text-color); font-size: 14px; line-height: 1.45; }
.error { background: var(--error-color, #db4437); color: #fff; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; font-size: 14px; }

button { font: inherit; font-size: 14px; font-weight: 500; border-radius: 18px; padding: 0 16px; height: 36px; cursor: pointer;
  border: 1px solid var(--divider-color, #ccc); background: transparent; color: var(--primary-color); white-space: nowrap; }
button.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: transparent; }
button.danger { color: var(--error-color, #db4437); }
button.icon { width: 36px; padding: 0; border: none; color: inherit; font-size: 22px; line-height: 1; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

ul { list-style: none; margin: 0; padding: 0; }
li.item { display: flex; align-items: center; gap: 12px; padding: 10px 8px; margin: 0 -8px; border-radius: 10px; cursor: pointer; }
li.item:hover { background: var(--secondary-background-color, #f2f2f2); }
.swatch { width: 14px; height: 14px; border-radius: 3px; flex: none; border: 2px solid var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 25%, transparent); }
.dot { width: 14px; height: 14px; border-radius: 50%; flex: none; background: ${DEVICE_COLOR}; border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0,0,0,.2); }
.grow { flex: 1; min-width: 0; }
.name { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { font-size: 13px; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { font-size: 12px; font-weight: 500; padding: 2px 8px; border-radius: 10px; flex: none;
  background: color-mix(in srgb, var(--primary-color) 15%, transparent); color: var(--primary-color); }
code { font-family: var(--code-font-family, monospace); font-size: 12px; }

label.field { display: block; margin-bottom: 14px; font-size: 13px; color: var(--secondary-text-color); }
label.field input { display: block; width: 100%; margin-top: 4px; height: 44px; padding: 0 12px; font: inherit; font-size: 16px;
  color: var(--primary-text-color); background: var(--secondary-background-color, #f5f5f5);
  border: 1px solid var(--divider-color, #ccc); border-radius: 8px; }
.row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.row3 label.field input { font-size: 15px; padding: 0 8px; }
.actions { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
.actions .spacer { flex: 1; }
details { margin-bottom: 14px; }
summary { cursor: pointer; color: var(--secondary-text-color); font-size: 14px; margin-bottom: 10px; }
.steps { margin: 0 0 14px; padding-left: 20px; color: var(--secondary-text-color); font-size: 14px; line-height: 1.6; }
.check { display: flex; align-items: center; gap: 12px; padding: 8px 0; cursor: pointer; }
.check input { width: 20px; height: 20px; flex: none; accent-color: var(--primary-color); }
.footer { font-size: 13px; color: var(--secondary-text-color); line-height: 1.5; }

/* map */
.leaflet-container { font: inherit; }
.zb-dark .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(.95) contrast(.9); }
.leaflet-tooltip.zb-label { background: rgba(255,255,255,.92); color: #212121; border: none; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.3);
  font-size: 12px; font-weight: 500; padding: 2px 8px; }
.leaflet-tooltip.zb-label::before { display: none; }
.leaflet-tooltip.zb-device { background: #212121; color: #fff; border: none; border-radius: 6px; font-size: 12px; padding: 2px 8px; }
.leaflet-tooltip.zb-device::before { border-right-color: #212121; }
.zb-h { background: transparent; border: none; }
.zb-h::after { content: ""; position: absolute; inset: 8px; background: #fff; border: 2px solid ${EDIT_COLOR}; border-radius: 3px;
  box-shadow: 0 1px 3px rgba(0,0,0,.4); }
.zb-h-edge::after { inset: 9px; border-radius: 50%; }
.zb-h-rotate { cursor: ${svgUrl(ICON_ROTATE, "#212121").replace(/"\)$/, '") 12 12')}, alias !important; }
.zb-h-rotate::after { inset: 3px; border-radius: 50%; background: #fff ${svgUrl(ICON_ROTATE, EDIT_COLOR)} center / 18px no-repeat; }
.zb-cur-move, .zb-cur-move .leaflet-interactive { cursor: move !important; }
.zb-cur-turn, .zb-cur-turn .leaflet-interactive { cursor: ${svgUrl(ICON_ROTATE, "#212121").replace(/"\)$/, '") 12 12')}, alias !important; }
.zb-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center;
  color: var(--secondary-text-color); }
/* Our own display rules would otherwise beat the hidden attribute, leaving an invisible
   layer over the map that swallows every drag. */
[hidden] { display: none !important; }
`;

class BoxZonesPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._zones = [];
    this._trackers = [];
    this._mode = { view: "loading" };
    this._error = "";
    this._busy = false;
    this._L = null;
    this._map = null;
    this._zoneLayers = new Map();
    this._deviceLayers = new Map();
    this._handles = null;
    this._drag = null;
    this._fields = {};
    this._listSig = "";
    this._fitted = false;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._menu) { this._menu.hass = hass; }
    if (first) this._init();
    else this._onHass();
  }
  get hass() { return this._hass; }

  set narrow(v) {
    this._narrow = !!v;
    this.toggleAttribute("narrow", this._narrow);
    if (this._menu) this._menu.narrow = this._narrow;
    if (this._map) setTimeout(() => this._map.invalidateSize(), 0);
  }
  set panel(_v) {}
  set route(_v) {}

  connectedCallback() {
    if (this._map) setTimeout(() => this._map.invalidateSize(), 0);
  }

  // ---------------------------------------------------------------- setup
  async _init() {
    const root = this.shadowRoot;
    root.append(
      h("style", {}, CSS),
      h("link", { rel: "stylesheet", href: `${BASE}leaflet/leaflet.css${V}` }),
    );
    this._menu = document.createElement("ha-menu-button");
    this._menu.hass = this._hass;
    this._menu.narrow = this._narrow;
    this._side = h("div", { id: "side" });
    this._mapEl = h("div", { id: "map" });
    this._mapMsg = h("div", { class: "zb-msg", hidden: true });
    root.append(
      h("div", { class: "layout" },
        h("div", { class: "toolbar" }, this._menu, h("div", { class: "title" }, "Box Zones")),
        h("div", { class: "main" },
          h("aside", { class: "side" }, this._side),
          h("div", { class: "mapwrap" }, this._mapEl, this._mapMsg))));
    this._render();

    try {
      const [geo, L] = await Promise.all([import(`${BASE}geo.js${V}`), loadLeaflet()]);
      G = geo;
      this._L = L;
      this._createMap();
    } catch (err) {
      this._mapMsg.hidden = false;
      this._mapMsg.textContent = `The map could not be loaded: ${err.message}`;
    }
    await this._load();
  }

  async _load() {
    try {
      this._apply(await this._hass.callWS({ type: "box_zones/get" }));
      this._mode = { view: "list" };
    } catch (err) {
      this._mode = { view: "failed", message: err.message || String(err) };
    }
    this._render();
    this._syncMap();
    this._fitAll();
  }

  _apply(payload) {
    this._zones = payload.zones || [];
    this._trackers = payload.trackers || [];
  }

  _createMap() {
    const L = this._L;
    const map = L.map(this._mapEl, {
      zoomControl: true, maxZoom: MAX_ZOOM, worldCopyJump: true,
      // Finer zoom steps for precise drawing.
      zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 120,
    });
    this._map = map;
    const layers = {};
    for (const [key, t] of Object.entries(TILES)) {
      layers[t.label] = L.tileLayer(t.url, {
        maxZoom: MAX_ZOOM, maxNativeZoom: 19, attribution: t.attribution,
        // Home Assistant sends no Referer; OpenStreetMap blocks tiles without one.
        referrerPolicy: "origin",
      });
      layers[t.label]._zbKey = key;
    }
    const chosen = TILES[readTileChoice()] ? readTileChoice() : "map";
    layers[TILES[chosen].label].addTo(map);
    this._tileKey = chosen;
    L.control.layers(layers, null, { position: "topright" }).addTo(map);
    map.on("baselayerchange", (e) => {
      this._tileKey = e.layer._zbKey;
      saveTileChoice(this._tileKey);
      this._applyDark();
    });
    this._applyDark();
    const home = this._hass.config || {};
    map.setView([home.latitude || 0, home.longitude || 0], home.latitude ? 16 : 2);
    map.on("zoomend viewreset resize", () => { if (!this._drag) this._placeHandles(); });
    // Capture phase: decide before Leaflet whether a drag moves/turns the box or pans the map.
    this._mapEl.addEventListener("pointerdown", (e) => this._onPointerDown(e), true);
    this._mapEl.addEventListener("pointermove", (e) => this._onPointerMove(e), true);
    this._mapEl.addEventListener("pointerup", (e) => this._onPointerUp(e), true);
    this._mapEl.addEventListener("pointercancel", (e) => this._onPointerUp(e), true);
    new ResizeObserver(() => map.invalidateSize()).observe(this._mapEl);
  }

  _applyDark() {
    if (!this._map) return;
    const dark = !!(this._hass.themes && this._hass.themes.darkMode) && TILES[this._tileKey].darkFilter;
    this._mapEl.classList.toggle("zb-dark", dark);
  }

  _onHass() {
    this._applyDark();
    if (!this._map || !G) return;
    this._syncDevices();
    if (this._mode.view === "list") {
      const sig = this._trackerSig();
      if (sig !== this._listSig) this._render();
    }
  }

  // ------------------------------------------------------------- helpers
  _primary() {
    const v = getComputedStyle(this).getPropertyValue("--primary-color").trim();
    return v || "#03a9f4";
  }

  _visibleZones() {
    const m = this._mode;
    if (m.view !== "edit") return this._zones;
    const others = this._zones.filter((z) => z.id !== m.draft.id);
    return [...others, m.draft];
  }

  _trackerInfo(t) {
    const states = this._hass.states;
    const src = states[t.source];
    const ours = t.entity_id ? states[t.entity_id] : null;
    const lat = src && Number(src.attributes.latitude);
    const lon = src && Number(src.attributes.longitude);
    return {
      ...t,
      name: (src && src.attributes.friendly_name) || t.source,
      state: ours ? ours.state : null,
      boxId: ours ? ours.attributes.box_zone_id : null,
      pos: src && Number.isFinite(lat) && Number.isFinite(lon) && src.attributes.latitude != null ? [lat, lon] : null,
    };
  }

  _trackerSig() {
    return this._trackers.map((t) => {
      const i = this._trackerInfo(t);
      return `${t.source}|${i.state}|${i.boxId}|${i.name}`;
    }).join(";");
  }

  _setError(msg) {
    this._error = msg || "";
    this._render();
  }

  // ------------------------------------------------------------ side panel
  _render() {
    const m = this._mode;
    let content;
    if (m.view === "loading") content = [h("section", {}, h("p", { class: "hint" }, "Loading…"))];
    else if (m.view === "failed") content = [h("section", {},
      h("div", { class: "error" }, m.message),
      h("p", { class: "hint" }, "Check that Box Zones is set up under Settings → Devices & services, then reload this page."))];
    else if (m.view === "edit") content = this._renderEdit();
    else if (m.view === "devices") content = this._renderDevices();
    else content = this._renderList();
    if (this._error) content.unshift(h("section", {}, h("div", { class: "error", role: "alert" }, this._error)));
    this._side.replaceChildren(...content);
  }

  _renderList() {
    this._listSig = this._trackerSig();
    const infos = this._trackers.map((t) => this._trackerInfo(t));
    const boxes = h("section", {},
      h("div", { class: "head" }, h("h2", {}, "Boxes"),
        h("button", { class: "primary", onclick: () => this._newBox(), disabled: !this._map }, "+ New box")),
      this._zones.length
        ? h("ul", {}, [...this._zones].sort((a, b) => a.name.localeCompare(b.name)).map((z) => {
          const here = infos.filter((i) => i.boxId === z.id).map((i) => i.name);
          return h("li", { class: "item", onclick: () => this._edit(z.id), title: "Open to edit" },
            h("span", { class: "swatch" }),
            h("div", { class: "grow" }, h("div", { class: "name" }, z.name), h("div", { class: "sub" }, G ? G.formatSize(z) : "")),
            here.length ? h("span", { class: "badge" }, here.length === 1 ? `${here[0]} is here` : `${here.length} here`) : null);
        }))
        : h("p", { class: "hint" }, "No boxes yet. Press New box, then drag the box over the place you want."));

    const devices = h("section", {},
      h("div", { class: "head" }, h("h2", {}, "Followed trackers"),
        h("button", { onclick: () => this._chooseDevices() }, this._trackers.length ? "Change" : "Choose")),
      this._trackers.length
        ? h("ul", {}, infos.map((i) => h("li", {
          class: "item", title: "Show on the map",
          onclick: () => { if (i.pos && this._map) this._map.setView(i.pos, Math.max(this._map.getZoom(), 17)); },
        },
        h("span", { class: "dot" }),
        h("div", { class: "grow" }, h("div", { class: "name" }, i.name),
          h("div", { class: "sub" }, i.entity_id ? h("code", {}, i.entity_id) : "Being created…")),
        h("span", { class: "badge" }, stateLabel(i.state)))))
        : h("p", { class: "hint" }, "Pick the car, phone or other tracker that Box Zones should follow."));

    const help = h("section", {}, h("div", { class: "footer" },
      "Each followed tracker gets a location entity. It shows the name of the box the tracker is in, and Home, Away or a normal zone when it isn't in a box. ",
      "In an automation, use a State trigger on that entity with To set to the box name."));
    return [boxes, devices, help];
  }

  _renderEdit() {
    const m = this._mode;
    const d = m.draft;
    const name = h("input", {
      type: "text", value: d.name, maxlength: "100", autocomplete: "off", enterkeyhint: "done",
      oninput: (e) => { d.name = e.target.value; this._syncZones(); },
      onkeydown: (e) => { if (e.key === "Enter") this._save(); else if (e.key === "Escape") this._cancel(); },
    });
    const num = (key, label, step) => {
      const input = h("input", {
        type: "number", inputmode: "decimal", step, value: String(Math.round(d[key] * 10) / 10),
        onchange: (e) => {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          if (key === "rotation_deg") d[key] = G.normDeg(v);
          else d[key] = Math.min(G.MAX_SIZE_M, Math.max(G.MIN_SIZE_M, v));
          this._syncZones(); this._placeHandles(); this._updateFields();
        },
      });
      this._fields[key] = input;
      return h("label", { class: "field" }, label, input);
    };
    this._fields = {};
    const view = h("section", {},
      h("div", { class: "head" }, h("h2", {}, m.isNew ? "New box" : "Edit box")),
      h("label", { class: "field" }, "Name (this is what the location entity will show)", name),
      h("ol", { class: "steps" },
        h("li", {}, "Drag inside the box to move it."),
        h("li", {}, "Drag the white squares and dots to change the size."),
        h("li", {}, "Drag the round turn button, or the box's edge, to turn it. Grab far from the middle for fine turns; hold Shift for 15° steps.")),
      h("details", {}, h("summary", {}, "Exact size"),
        h("div", { class: "row3" }, num("width_m", "Width (m)", "1"), num("height_m", "Height (m)", "1"), num("rotation_deg", "Turn (°)", "0.1"))),
      h("div", { class: "actions" },
        h("button", { class: "primary", onclick: () => this._save(), disabled: this._busy }, "Save"),
        h("button", { onclick: () => this._cancel(), disabled: this._busy }, "Cancel"),
        h("span", { class: "spacer" }),
        m.isNew ? null : h("button", { class: "danger", onclick: () => this._delete(), disabled: this._busy }, "Delete")));
    if (m.isNew) setTimeout(() => { name.focus(); name.select(); }, 50);
    return [view];
  }

  _updateFields() {
    const d = this._mode.draft;
    if (!d) return;
    for (const [key, input] of Object.entries(this._fields)) {
      if (this.shadowRoot.activeElement !== input) input.value = String(Math.round(d[key] * 10) / 10);
    }
  }

  _renderDevices() {
    const m = this._mode;
    const ours = new Set(this._trackers.map((t) => t.entity_id).filter(Boolean));
    const states = Object.values(this._hass.states).filter((s) =>
      s.entity_id.startsWith("device_tracker.") && !ours.has(s.entity_id)
      && !(s.attributes.source_entity && s.entity_id.endsWith("_box_zones"))
      && (s.attributes.latitude != null || m.selected.has(s.entity_id)));
    states.sort((a, b) => (a.attributes.friendly_name || a.entity_id).localeCompare(b.attributes.friendly_name || b.entity_id));
    const list = states.length
      ? h("div", {}, states.map((s) => h("label", { class: "check" },
        h("input", {
          type: "checkbox", checked: m.selected.has(s.entity_id),
          onchange: (e) => { if (e.target.checked) m.selected.add(s.entity_id); else m.selected.delete(s.entity_id); },
        }),
        h("div", { class: "grow" }, h("div", { class: "name" }, s.attributes.friendly_name || s.entity_id),
          h("div", { class: "sub" }, h("code", {}, s.entity_id))))))
      : h("p", { class: "hint" }, "No trackers with a GPS position were found. Box Zones works with trackers that report a position, such as the Home Assistant app or a car integration.");
    return [h("section", {},
      h("div", { class: "head" }, h("h2", {}, "Followed trackers")),
      h("p", { class: "hint" }, "Tick the trackers to follow. Each one gets its own location entity. Unticking one stops following it and removes its location entity."),
      list,
      h("div", { class: "actions" },
        h("button", { class: "primary", onclick: () => this._saveDevices(), disabled: this._busy }, this._busy ? "Saving…" : "Save"),
        h("button", { onclick: () => { this._mode = { view: "list" }; this._error = ""; this._render(); }, disabled: this._busy }, "Cancel")))];
  }

  // --------------------------------------------------------------- actions
  _newBox() {
    if (!this._map || this._mode.view === "edit") return;
    const map = this._map;
    const c = map.getCenter();
    const b = map.getBounds();
    const viewW = map.distance([c.lat, b.getWest()], [c.lat, b.getEast()]);
    const width = G.niceMetres(Math.min(5000, Math.max(10, viewW * 0.3)));
    const names = new Set(this._zones.map((z) => z.name));
    let n = this._zones.length + 1;
    while (names.has(`Box ${n}`)) n++;
    const draft = { id: G.newId(), name: `Box ${n}`, lat: c.lat, lon: c.lng, width_m: width, height_m: G.niceMetres(width * 0.6), rotation_deg: 0 };
    this._mode = { view: "edit", draft, isNew: true };
    this._error = "";
    this._render();
    this._syncMap();
  }

  _edit(id) {
    const z = this._zones.find((x) => x.id === id);
    if (!z || this._mode.view === "edit") return;
    this._mode = { view: "edit", draft: { ...z }, isNew: false };
    this._error = "";
    this._render();
    this._syncMap();
    // Zoom so the box is big enough to grab its handles (and fully visible).
    const bounds = this._L.latLngBounds(G.corners(z).map((p) => [p.lat, p.lon]));
    const map = this._map;
    const a = map.latLngToContainerPoint(bounds.getNorthWest());
    const b = map.latLngToContainerPoint(bounds.getSouthEast());
    const size = map.getSize();
    const small = Math.abs(b.x - a.x) < size.x / 3 && Math.abs(b.y - a.y) < size.y / 3;
    if (small || !map.getBounds().contains(bounds)) map.fitBounds(bounds, { padding: [70, 70], maxZoom: 22 });
  }

  _cancel() {
    this._mode = { view: "list" };
    this._error = "";
    this._render();
    this._syncMap();
  }

  async _save() {
    const d = this._mode.draft;
    if (!d || this._busy) return;
    if (!d.name.trim()) { this._setError("Give the box a name first."); return; }
    this._busy = true;
    try {
      const res = await this._hass.callWS({ type: "box_zones/save_zone", zone: { ...d, name: d.name.trim() } });
      this._apply(res);
      this._mode = { view: "list" };
      this._error = "";
    } catch (err) {
      this._error = `Could not save: ${err.message || err}`;
    }
    this._busy = false;
    this._render();
    this._syncMap();
  }

  async _delete() {
    const d = this._mode.draft;
    if (!d || this._busy) return;
    if (!window.confirm(`Delete the box "${d.name}"?`)) return;
    this._busy = true;
    try {
      this._apply(await this._hass.callWS({ type: "box_zones/delete_zone", zone_id: d.id }));
      this._mode = { view: "list" };
      this._error = "";
    } catch (err) {
      this._error = `Could not delete: ${err.message || err}`;
    }
    this._busy = false;
    this._render();
    this._syncMap();
  }

  _chooseDevices() {
    this._mode = { view: "devices", selected: new Set(this._trackers.map((t) => t.source)) };
    this._error = "";
    this._render();
  }

  async _saveDevices() {
    const m = this._mode;
    if (this._busy) return;
    const dropped = this._trackers.filter((t) => !m.selected.has(t.source));
    if (dropped.length) {
      const names = dropped.map((t) => this._trackerInfo(t).name).join(", ");
      if (!window.confirm(`Stop following ${names}? Its Box Zones location entity will be removed.`)) return;
    }
    this._busy = true;
    this._render();
    try {
      this._apply(await this._hass.callWS({ type: "box_zones/set_trackers", trackers: [...m.selected] }));
      this._mode = { view: "list" };
      this._error = "";
    } catch (err) {
      this._error = `Could not save: ${err.message || err}`;
    }
    this._busy = false;
    this._render();
    this._syncMap();
  }

  // ------------------------------------------------------------------ map
  _syncMap() {
    if (!this._map || !G) return;
    this._syncZones();
    this._syncHandles();
    this._syncDevices();
  }

  _fitAll() {
    if (!this._map || !G || this._fitted) return;
    const pts = [];
    for (const z of this._zones) for (const p of G.corners(z)) pts.push([p.lat, p.lon]);
    for (const t of this._trackers) { const i = this._trackerInfo(t); if (i.pos) pts.push(i.pos); }
    if (!pts.length) return;
    this._fitted = true;
    // Wait for the layout (the phone layout splits the screen), then fit.
    requestAnimationFrame(() => {
      this._map.invalidateSize();
      this._map.fitBounds(this._L.latLngBounds(pts), { padding: [40, 40], maxZoom: 18 });
    });
  }

  _syncZones() {
    if (!this._map || !G) return;
    const L = this._L;
    const editing = this._mode.view === "edit" ? this._mode.draft.id : null;
    const primary = this._primary();
    const zones = this._visibleZones();
    const ids = new Set(zones.map((z) => z.id));
    for (const [id, l] of this._zoneLayers) {
      if (!ids.has(id)) { l.poly.remove(); l.label.remove(); this._zoneLayers.delete(id); }
    }
    for (const z of zones) {
      const isEdit = z.id === editing;
      const color = isEdit ? EDIT_COLOR : primary;
      const style = {
        color, fillColor: color, weight: isEdit ? 3 : 2,
        fillOpacity: isEdit ? 0.25 : editing ? 0.08 : 0.18, opacity: editing && !isEdit ? 0.5 : 1,
      };
      const pts = G.outline(z).map((p) => [p.lat, p.lon]);
      let l = this._zoneLayers.get(z.id);
      if (!l) {
        const poly = L.polygon(pts, style).addTo(this._map);
        poly.on("click", (e) => { L.DomEvent.stopPropagation(e); this._edit(z.id); });
        const label = L.tooltip({ permanent: true, direction: "center", className: "zb-label", interactive: false })
          .setLatLng([z.lat, z.lon]).setContent(document.createTextNode(z.name || " ")).addTo(this._map);
        l = { poly, label, name: z.name };
        this._zoneLayers.set(z.id, l);
      } else {
        l.poly.setLatLngs(pts);
        l.label.setLatLng([z.lat, z.lon]);
      }
      l.poly.setStyle(style);
      if (l.name !== z.name) {
        // setContent with a text node: names are never parsed as HTML.
        l.label.setContent(document.createTextNode(z.name || " "));
        l.name = z.name;
      }
      // The name is in the editor while editing; its label would cover the handles.
      l.label.setOpacity(isEdit ? 0 : 1);
      if (isEdit) l.poly.bringToFront();
    }
  }

  _syncHandles() {
    const L = this._L;
    const editing = this._mode.view === "edit" ? this._mode.draft : null;
    if (this._handles && (!editing || this._handles.id !== editing.id)) {
      for (const mk of Object.values(this._handles.markers)) mk.remove();
      this._handles.line.remove();
      this._handles = null;
    }
    if (editing && !this._handles) {
      const markers = {};
      for (const key of Object.keys(G.HANDLES)) markers[key] = this._makeHandle(key).addTo(this._map);
      // The turn button is not a Leaflet drag: the pointer handlers below turn the box
      // by how far you go around the middle, the same way as dragging the edge.
      markers.rotate = L.marker([0, 0], {
        icon: L.divIcon({ className: "zb-h zb-h-rotate", iconSize: [30, 30] }),
        keyboard: false, zIndexOffset: 1000, title: "Turn",
      }).addTo(this._map);
      const line = L.polyline([], { color: EDIT_COLOR, weight: 2, dashArray: "4 4", interactive: false }).addTo(this._map);
      this._handles = { id: editing.id, markers, line };
    }
    this._placeHandles();
  }

  _makeHandle(key) {
    const L = this._L;
    const cls = key.length === 1 ? "zb-h-edge" : "zb-h-corner";
    const size = 30;
    const mk = L.marker([0, 0], {
      icon: L.divIcon({ className: `zb-h ${cls}`, iconSize: [size, size] }),
      draggable: true, autoPan: false, keyboard: false, zIndexOffset: 1000, title: "Resize",
    });
    mk.on("dragstart", () => {
      const d = this._mode.draft;
      if (!d) return;
      this._drag = { key, base: { ...d }, start: mk.getLatLng() };
      this._map.dragging.disable();
    });
    mk.on("drag", (e) => this._onDrag(key, e.latlng));
    mk.on("dragend", () => {
      this._drag = null;
      this._map.dragging.enable();
      this._placeHandles();
      this._updateFields();
    });
    return mk;
  }

  _onDrag(key, ll) {
    const d = this._mode.draft;
    const drag = this._drag;
    if (!d || !drag || drag.key !== key) return;
    const b = drag.base;
    const next = G.resize(b, key, ll.lat, ll.lng);
    for (const f of ["lat", "lon", "width_m", "height_m", "rotation_deg"]) d[f] = next[f];
    this._syncZones();
    this._placeHandles(key);
    this._updateFields();
  }

  _placeHandles(skip) {
    if (!this._handles || this._mode.view !== "edit") return;
    const d = this._mode.draft;
    for (const [key, [sx, sy]] of Object.entries(G.HANDLES)) {
      if (key === skip) continue;
      const p = G.localToGeo(d, (sx * d.width_m) / 2, (sy * d.height_m) / 2);
      this._handles.markers[key].setLatLng([p.lat, p.lon]);
    }
    const top = G.localToGeo(d, 0, d.height_m / 2);
    const c = this._map.latLngToContainerPoint([d.lat, d.lon]);
    const tp = this._map.latLngToContainerPoint([top.lat, top.lon]);
    const rp = G.rotateHandlePx(c, tp, d.rotation_deg);
    const rl = this._map.containerPointToLatLng([rp.x, rp.y]);
    this._handles.markers.rotate.setLatLng(rl);
    this._handles.line.setLatLngs([[top.lat, top.lon], rl]);
  }

  // ---------------------------------------------- move and turn by dragging the box
  /** "move" (inside the box), "turn" (on its edge) or null (let the map pan). */
  _gestureAt(e) {
    if (this._mode.view !== "edit" || !this._map) return null;
    for (const n of e.composedPath()) {
      if (n === this._mapEl) break;
      if (n.classList && n.classList.contains("zb-h-rotate")) return "turn";
      // Resize handles and map controls handle their own events.
      if (n.classList && (n.classList.contains("zb-h") || n.classList.contains("leaflet-control"))) return null;
    }
    const d = this._mode.draft;
    const pt = this._map.mouseEventToContainerPoint(e);
    const cs = G.corners(d).map((p) => this._map.latLngToContainerPoint([p.lat, p.lon]));
    let edge = Infinity;
    for (let i = 0; i < 4; i++) edge = Math.min(edge, G.distToSegment(pt, cs[i], cs[(i + 1) % 4]));
    const inside = G.pointInPolygon(pt, cs);
    const shortSide = Math.min(cs[0].distanceTo(cs[1]), cs[1].distanceTo(cs[2]));
    const tol = e.pointerType === "touch" ? EDGE_PX.touch : EDGE_PX.mouse;
    // On a box that is small on screen, keep the middle for moving.
    if (inside && edge > Math.min(tol, shortSide / 4)) return "move";
    if (edge <= tol) return "turn";
    return null;
  }

  _onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const kind = this._gestureAt(e);
    if (!kind) return;
    // Keep Leaflet from panning the map, and the browser from sending mouse events too.
    e.preventDefault();
    e.stopImmediatePropagation();
    const d = this._mode.draft;
    const pt = this._map.mouseEventToContainerPoint(e);
    const c = this._map.latLngToContainerPoint([d.lat, d.lon]);
    this._gesture = {
      kind, pointerId: e.pointerId, base: { ...d },
      startLL: this._map.containerPointToLatLng(pt), center: c,
      startAngle: Math.atan2(pt.y - c.y, pt.x - c.x),
    };
    this._mapEl.setPointerCapture(e.pointerId);
  }

  _onPointerMove(e) {
    const g = this._gesture;
    if (!g) {
      if (e.pointerType === "mouse") {
        const kind = this._gestureAt(e);
        this._mapEl.classList.toggle("zb-cur-move", kind === "move");
        this._mapEl.classList.toggle("zb-cur-turn", kind === "turn");
      }
      return;
    }
    if (e.pointerId !== g.pointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const d = this._mode.draft;
    const pt = this._map.mouseEventToContainerPoint(e);
    if (g.kind === "move") {
      const ll = this._map.containerPointToLatLng(pt);
      d.lat = g.base.lat + ll.lat - g.startLL.lat;
      d.lon = g.base.lon + ll.lng - g.startLL.lng;
    } else {
      // Turn by how far the pointer went around the middle, not by where it points:
      // no jump when you grab the edge, and finer control further from the middle.
      const a = Math.atan2(pt.y - g.center.y, pt.x - g.center.x);
      d.rotation_deg = G.turnBy(g.base.rotation_deg, G.toDeg(a - g.startAngle), e.shiftKey ? 15 : 0);
    }
    this._syncZones();
    this._placeHandles();
    this._updateFields();
  }

  _onPointerUp(e) {
    const g = this._gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    e.stopImmediatePropagation();
    this._gesture = null;
    if (this._mapEl.hasPointerCapture(e.pointerId)) this._mapEl.releasePointerCapture(e.pointerId);
    this._updateFields();
  }

  _syncDevices() {
    if (!this._map) return;
    const L = this._L;
    const seen = new Set();
    for (const t of this._trackers) {
      const i = this._trackerInfo(t);
      if (!i.pos) continue;
      seen.add(t.source);
      let l = this._deviceLayers.get(t.source);
      if (!l) {
        const dot = L.circleMarker(i.pos, {
          radius: 8, color: "#fff", weight: 2, fillColor: DEVICE_COLOR, fillOpacity: 1, interactive: false,
        }).addTo(this._map);
        const label = L.tooltip({ permanent: true, direction: "right", offset: [10, 0], className: "zb-device", interactive: false })
          .setLatLng(i.pos).setContent(document.createTextNode(i.name)).addTo(this._map);
        l = { dot, label, name: i.name };
        this._deviceLayers.set(t.source, l);
      }
      l.dot.setLatLng(i.pos);
      l.label.setLatLng(i.pos);
      if (l.name !== i.name) { l.label.setContent(document.createTextNode(i.name)); l.name = i.name; }
    }
    for (const [id, l] of this._deviceLayers) {
      if (!seen.has(id)) { l.dot.remove(); l.label.remove(); this._deviceLayers.delete(id); }
    }
  }
}

if (!customElements.get("box-zones-panel")) customElements.define("box-zones-panel", BoxZonesPanel);
