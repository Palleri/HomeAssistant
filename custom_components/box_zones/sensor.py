"""One entity per box, for example sensor.box_zones_parking.

The location entities list the boxes they are in by these entity IDs (their
in_zones attribute), the way Home Assistant lists round zones. The state is the
number of followed trackers inside the box.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import slugify

from . import BoxZonesConfigEntry
from .const import DOMAIN, SIGNAL_BOX_ENTITIES_UPDATED, SIGNAL_POSITIONS_UPDATED, SIGNAL_ZONES_UPDATED
from .geometry import POLYGON, RECTANGLE, area_m2, contains, equivalent_radius, label_point, shape_of
from .store import ZoneStore

UNIQUE_PREFIX = "box_"


def box_entity_id(hass: HomeAssistant, zone_id: str) -> str | None:
    return er.async_get(hass).async_get_entity_id("sensor", DOMAIN, f"{UNIQUE_PREFIX}{zone_id}")


async def async_setup_entry(
    hass: HomeAssistant,
    entry: BoxZonesConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    store = entry.runtime_data
    registry = er.async_get(hass)
    entities: dict[str, BoxZoneSensor] = {}

    @callback
    def sync() -> None:
        ids = {z["id"] for z in store.zones}
        new = []
        for zone in store.zones:
            if zone["id"] in entities:
                entities[zone["id"]].set_zone(zone)
            else:
                entities[zone["id"]] = entity = BoxZoneSensor(store, zone)
                new.append(entity)
        for zone_id in [z for z in entities if z not in ids]:
            entity = entities.pop(zone_id)
            if entity.registry_entry is not None:
                registry.async_remove(entity.entity_id)  # also removes the entity
            else:
                hass.async_create_task(entity.async_remove())
        if new:
            async_add_entities(new)

    # Boxes deleted while Home Assistant was off.
    known = {z["id"] for z in store.zones}
    for reg_entry in er.async_entries_for_config_entry(registry, entry.entry_id):
        if reg_entry.domain == "sensor" and reg_entry.unique_id.removeprefix(UNIQUE_PREFIX) not in known:
            registry.async_remove(reg_entry.entity_id)

    sync()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_ZONES_UPDATED, sync))


class BoxZoneSensor(SensorEntity):
    _attr_should_poll = False
    _attr_icon = "mdi:vector-square"
    # A polygon's corners can be long; keep them out of the history database.
    _unrecorded_attributes = frozenset({"points"})

    def __init__(self, store: ZoneStore, zone: dict[str, Any]) -> None:
        self._store = store
        self._zone = zone
        self._attr_unique_id = f"{UNIQUE_PREFIX}{zone['id']}"
        self.entity_id = f"sensor.box_zones_{slugify(zone['name']) or 'box'}"
        # The location entities show this name, so it must be exactly the box name.
        self._attr_name = zone["name"]

    @callback
    def set_zone(self, zone: dict[str, Any]) -> None:
        renamed = zone["name"] != self._zone["name"]
        self._zone = zone
        self._attr_name = zone["name"]
        if self.hass is not None:
            self.async_write_ha_state()
            if renamed:
                # The location entities show this entity's name: re-read it now.
                async_dispatcher_send(self.hass, SIGNAL_BOX_ENTITIES_UPDATED)

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_POSITIONS_UPDATED, self._recount))
        # Tell the location entities this box can be referred to, and again once it's gone.
        # call_soon: Home Assistant writes our state right after this method returns, and
        # removes it right after the on_remove callbacks; the trackers must see that.
        hass = self.hass
        hass.loop.call_soon(async_dispatcher_send, hass, SIGNAL_BOX_ENTITIES_UPDATED)
        self.async_on_remove(
            lambda: hass.loop.call_soon(async_dispatcher_send, hass, SIGNAL_BOX_ENTITIES_UPDATED)
        )

    @callback
    def _recount(self) -> None:
        self.async_write_ha_state()

    def _inside(self) -> list[str]:
        return [
            pos[0]
            for pos in self._store.positions.values()
            if pos is not None and contains(self._zone, pos[1], pos[2])
        ]

    @property
    def native_value(self) -> int:
        return len(self._inside())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        z = self._zone
        lat, lon = label_point(z)
        attrs: dict[str, Any] = {
            # Home Assistant compares a box with round zones by this radius (same area).
            "radius": round(equivalent_radius(z), 2),
            "passive": False,
            "box_id": z["id"],
            "shape": shape_of(z),
            "area_m2": round(area_m2(z), 2),
        }
        if shape_of(z) == RECTANGLE:
            attrs.update(width_m=z["width_m"], height_m=z["height_m"], rotation_deg=z["rotation_deg"])
        elif shape_of(z) == POLYGON:
            attrs["points"] = [list(p) for p in z["points"]]
        attrs.update(center_latitude=lat, center_longitude=lon, trackers=self._inside())
        return attrs
