# Box Zones

**Rectangular zones for Home Assistant.** Draw boxes on a map, turn them to any
angle, and see which box your car or phone is in.

Home Assistant's own zones are always circles. A circle is a bad fit for a
parking spot, a driveway or one side of a street. Box Zones lets you draw a box
instead.

## Install

1. **Add it to HACS:**
   [![Open in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Palleri&repository=HomeAssistant&category=integration)
   Press **Download**, then **restart Home Assistant**.
2. **Set it up:**
   [![Add integration](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=box_zones)
   Pick the trackers to follow, for example your car.
3. **Draw a box:** open **Box Zones** in the sidebar, press **New box**, drag
   it into place, give it a name and press **Save**.

That's it.

<details>
<summary>Without the buttons</summary>

- HACS → ⋮ → **Custom repositories** → add `https://github.com/Palleri/HomeAssistant`
  as type **Integration** → find **Box Zones** → **Download** → restart.
- Settings → Devices & services → **Add integration** → **Box Zones**.
- Manual install: copy `custom_components/box_zones` to
  `/config/custom_components/box_zones` and restart.

</details>

## What you get

For every tracker you follow, Box Zones adds a location entity next to it:

| Your tracker | Box Zones entity |
|---|---|
| `device_tracker.car` | `device_tracker.car_box_zones` |

The entity shows:

- **the box name** when the tracker is inside a box, for example `Parking`
- otherwise exactly what a normal tracker shows: **Home**, **Away**, or the
  name of one of your normal zones

It works anywhere a tracker works: maps, history, and you can even add it to a
**person**.

## Use it in an automation

Use a **State** trigger on the Box Zones entity:

```yaml
triggers:
  - trigger: state
    entity_id: device_tracker.car_box_zones
    to: Parking        # the car arrives in the box called "Parking"
```

To trigger when the car leaves, use `from: Parking` instead.

> Home Assistant's **Zone** trigger only knows round zones, so your boxes don't
> show up there. Use the State trigger above.

## Good to know

- **Overlapping boxes:** the smallest box wins. So a "Parking spot" box inside
  a "Street" box shows "Parking spot" when the car is in the spot.
- **Same name, more boxes:** several boxes can share one name, for example two
  spots that both count as `Parking`.
- **More trackers:** one Box Zones follows as many trackers as you like. Add
  one with **Add tracker** on Settings → Devices & services → Box Zones, or
  with **Change** under **Followed trackers** on the Box Zones page. To stop
  following one, delete it from the integration's page or untick it there.
- **Map:** the background map comes from OpenStreetMap; the layer button on
  the map switches to satellite images (Esri), which helps when drawing
  parking spots. Everything else runs locally in Home Assistant.
- The Box Zones page is for admins only.
- Your boxes are stored in `/config/.storage/box_zones.zones` and are part of
  normal Home Assistant backups.

## Development

```bash
pip install -r requirements_test.txt
pip install "$(python scripts/frontend_requirement.py)"
pytest
node --test tests/js/*.test.mjs
```

The box maths exists twice, in `geometry.py` (for the entities) and
`frontend/geo.js` (for the map). A test checks that they agree.

## License

MIT, see [LICENSE](LICENSE). The bundled map library
[Leaflet](https://leafletjs.com) has its own BSD-2-Clause license in
`custom_components/box_zones/frontend/leaflet/LICENSE`.

## Releasing

Change `version` in `custom_components/box_zones/manifest.json` and `VERSION`
in `const.py` (a test checks they match), then merge to `main`. The Release
workflow creates the GitHub release, for example `v0.1.2`, and HACS offers it
as an update.
