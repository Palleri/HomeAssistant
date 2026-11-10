<img src="images/icon.png" alt="" width="96" align="right">

# Box Zones

**Rectangle + polygon zones for Home Assistant.** Draw boxes on map, see which box tracker is in. HA zones = circles only.

- **Rectangle:** move, resize, turn any angle. Parking spots.
- **Polygon:** 3–100 corners, concave ok, no self-crossing. Driveways, plots.

## Install

1. [![Open in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Palleri&repository=HomeAssistant&category=integration) → **Download** → restart HA.
2. [![Add integration](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=box_zones) → pick trackers.
3. Sidebar **Box Zones** → **Add rectangle** / **Add polygon** → name → **Save**.

Manual: copy `custom_components/box_zones` to `/config/custom_components/`, restart.

## Drawing

**Rectangle:** drag inside = move, corners/side dots = resize, edge = turn. **Duplicate** = copy beside it.

**Polygon:** tap each corner in order. Close: tap first corner or **Done**. **Undo** / **Cancel** (Esc).
Edit: drag corner = move, drag side dot = add corner, **Remove corner** or right-click = remove, drag inside = move all.
Invalid outline (crossing, <4 m², >50 km) → red dashed, Save off.

Shape fixed after creation.

## Entities

| Entity | State |
|---|---|
| `device_tracker.car_box_zones` | box name, else Home / Away / zone |
| `sensor.box_zones_parking` | count of trackers inside |

Sensor attrs: `trackers`, `shape`, `area_m2`, `center_latitude`, `center_longitude`; rectangle: `width_m`, `height_m`, `rotation_deg`; polygon: `points`.

## Automation

```yaml
triggers:
  - trigger: state
    entity_id: device_tracker.car_box_zones
    to: Parking   # leave: from: Parking
```

HA **Zone** trigger ignores boxes — use State.

## Notes

- Overlap: smallest area wins (boxes + round zones). Zone conditions still work.
- Boxes may share a name.
- Storage: `/config/.storage/box_zones.zones`, in backups. Downgrade to 0.3.x after 0.4 refuses to load.
- After update: reload page.
- Map: OpenStreetMap / Esri satellite. Admins only.

## Dev

```bash
pip install -r requirements_test.txt
pip install "$(python scripts/frontend_requirement.py)"
pytest
node --test tests/js/*.test.mjs
```

Geometry in `geometry.py` + `frontend/geo.js`, test checks they agree. Release: bump `manifest.json` `version` + `const.py` `VERSION`, merge to `main`.

## License

MIT. Bundled [Leaflet](https://leafletjs.com): BSD-2-Clause.
