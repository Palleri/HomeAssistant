"""One location entity per followed tracker.

Its state is the name of the box the tracker is in. Outside every box it
behaves like any GPS tracker: home, not_home (shown as Away) or the name of
one of Home Assistant's own round zones.
"""

from __future__ import annotations

import math
from typing import Any

from homeassistant.components.device_tracker import SourceType, TrackerEntity
from homeassistant.const import ATTR_FRIENDLY_NAME, ATTR_LATITUDE, ATTR_LONGITUDE, STATE_UNAVAILABLE
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, State, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event

from . import BoxZonesConfigEntry
from .const import CONF_TRACKERS, ENTITY_SUFFIX, SIGNAL_ZONES_UPDATED
from .geometry import find_zone
from .store import ZoneStore

ATTR_SOURCE = "source_entity"
ATTR_BOX = "box_zone"
ATTR_BOX_ID = "box_zone_id"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: BoxZonesConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    trackers = entry.options.get(CONF_TRACKERS, [])
    # Remove the entities of trackers that are no longer followed.
    registry = er.async_get(hass)
    for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
        if entity.domain == "device_tracker" and entity.unique_id not in trackers:
            registry.async_remove(entity.entity_id)
    async_add_entities(BoxZonesTracker(entry.runtime_data, source) for source in trackers)


def our_entity_id(source: str) -> str:
    """device_tracker.car -> device_tracker.car_box_zones."""
    return f"device_tracker.{source.split('.', 1)[1]}{ENTITY_SUFFIX}"


def _coordinate(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


class BoxZonesTracker(TrackerEntity):
    """Follows one tracker and adds the boxes on top of Home Assistant's zones."""

    _attr_should_poll = False
    _attr_source_type = SourceType.GPS
    _attr_icon = "mdi:map-marker-radius"

    def __init__(self, store: ZoneStore, source: str) -> None:
        self._store = store
        self._source = source
        self._attr_unique_id = source
        self.entity_id = our_entity_id(source)
        self._attr_name = f"{source} (Box Zones)"
        self._box: dict[str, Any] | None = None

    @property
    def force_update(self) -> bool:
        return False

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_track_state_change_event(self.hass, [self._source], self._async_source_changed)
        )
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_ZONES_UPDATED, self._async_zones_changed)
        )
        self._update(self.hass.states.get(self._source))

    @callback
    def _async_source_changed(self, event: Event[EventStateChangedData]) -> None:
        self._update(event.data["new_state"])
        self.async_write_ha_state()

    @callback
    def _async_zones_changed(self) -> None:
        self._update(self.hass.states.get(self._source))
        self.async_write_ha_state()

    @callback
    def _update(self, state: State | None) -> None:
        self._box = None
        if state is None or state.state == STATE_UNAVAILABLE:
            self._attr_available = False
            self._attr_latitude = self._attr_longitude = None
            self._attr_location_name = None
            return
        self._attr_available = True
        self._attr_name = f"{state.attributes.get(ATTR_FRIENDLY_NAME) or self._source} (Box Zones)"
        lat = _coordinate(state.attributes.get(ATTR_LATITUDE))
        lon = _coordinate(state.attributes.get(ATTR_LONGITUDE))
        accuracy = _coordinate(state.attributes.get("gps_accuracy"))
        self._attr_location_accuracy = accuracy if accuracy is not None and accuracy >= 0 else 0
        self._attr_latitude, self._attr_longitude = lat, lon
        if lat is None or lon is None:
            # No position (for example a router-based tracker): pass its state through.
            self._attr_location_name = state.state
            return
        self._box = find_zone(self._store.zones, lat, lon)
        # None lets Home Assistant pick home / not_home / one of its own zones.
        self._attr_location_name = self._box["name"] if self._box else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            ATTR_SOURCE: self._source,
            ATTR_BOX: self._box["name"] if self._box else None,
            ATTR_BOX_ID: self._box["id"] if self._box else None,
        }
