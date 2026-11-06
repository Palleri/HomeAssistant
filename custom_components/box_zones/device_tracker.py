"""One location entity per followed tracker.

Its state is the name of the box the tracker is in. Outside every box it
behaves like any GPS tracker: home, not_home (shown as Away) or the name of
one of Home Assistant's own round zones. When a box and a round zone overlap,
the smaller one wins, the same rule Home Assistant uses between round zones.

On Home Assistant 2026.10 and newer this uses in_zones: the entity lists the
box entities (sensor.box_zones_*) and round zones it is in, and Home Assistant
picks the state. Older versions get the name through location_name.
"""

from __future__ import annotations

import logging
import math
from typing import Any

from homeassistant.components import zone
from homeassistant.components.device_tracker import SourceType, TrackerEntity
from homeassistant.const import (
    ATTR_FRIENDLY_NAME,
    ATTR_LATITUDE,
    ATTR_LONGITUDE,
    STATE_HOME,
    STATE_NOT_HOME,
    STATE_UNAVAILABLE,
)
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, State, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event

from . import BoxZonesConfigEntry
from .config_flow import followed
from .const import (
    CONF_ENTITY_ID,
    ENTITY_SUFFIX,
    SIGNAL_BOX_ENTITIES_UPDATED,
    SIGNAL_POSITIONS_UPDATED,
    SIGNAL_ZONES_UPDATED,
    SUBENTRY_TRACKER,
)
from .geometry import equivalent_radius, find_zones
from .sensor import box_entity_id
from .store import ZoneStore

_LOGGER = logging.getLogger(__name__)

ATTR_SOURCE = "source_entity"
ATTR_BOX = "box_zone"
ATTR_BOX_ID = "box_zone_id"
ATTR_IN_ZONES = "in_zones"

# Home Assistant 2026.10 replaced location_name with in_zones.
SUPPORTS_IN_ZONES = hasattr(TrackerEntity, "in_zones")


async def async_setup_entry(
    hass: HomeAssistant,
    entry: BoxZonesConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    trackers = followed(entry)
    # Remove the entities of trackers that are no longer followed.
    registry = er.async_get(hass)
    for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
        if entity.domain == "device_tracker" and entity.unique_id not in trackers:
            registry.async_remove(entity.entity_id)
    for sub in entry.subentries.values():
        if sub.subentry_type == SUBENTRY_TRACKER:
            async_add_entities(
                [BoxZonesTracker(entry, sub.subentry_id, sub.data[CONF_ENTITY_ID])],
                config_subentry_id=sub.subentry_id,
            )


def our_entity_id(source: str) -> str:
    """device_tracker.car -> device_tracker.car_box_zones."""
    return f"device_tracker.{source.split('.', 1)[1]}{ENTITY_SUFFIX}"


def _coordinate(value: Any) -> float | None:
    """A number, also when the tracker sends it as text ("59.26")."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


# Trackers name their GPS accuracy differently.
ACCURACY_ATTRIBUTES = ("gps_accuracy", "accuracy", "horizontal_accuracy")


class BoxZonesTracker(TrackerEntity):
    """Follows one tracker and adds the boxes on top of Home Assistant's zones."""

    _attr_should_poll = False
    _attr_source_type = SourceType.GPS
    _attr_icon = "mdi:map-marker-radius"

    def __init__(self, entry: BoxZonesConfigEntry, subentry_id: str, source: str) -> None:
        self._entry = entry
        self._subentry_id = subentry_id
        self._store: ZoneStore = entry.runtime_data
        self._source = source
        self._attr_unique_id = source
        self.entity_id = our_entity_id(source)
        self._attr_name = f"{source} (Box Zones)"
        self._box: dict[str, Any] | None = None
        self._warned_no_position = False

    @property
    def force_update(self) -> bool:
        return False

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_track_state_change_event(self.hass, [self._source], self._async_source_changed)
        )
        for signal in (SIGNAL_ZONES_UPDATED, SIGNAL_BOX_ENTITIES_UPDATED):
            self.async_on_remove(async_dispatcher_connect(self.hass, signal, self._async_zones_changed))
        self.async_on_remove(self._forget_position)
        self._update(self.hass.states.get(self._source))

    @callback
    def _forget_position(self) -> None:
        if self._store.positions.pop(self._source, None) is not None:
            async_dispatcher_send(self.hass, SIGNAL_POSITIONS_UPDATED)

    @callback
    def _set_position(self, position: tuple[str, float, float] | None) -> None:
        if self._store.positions.get(self._source) != position:
            self._store.positions[self._source] = position
            async_dispatcher_send(self.hass, SIGNAL_POSITIONS_UPDATED)

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
        self._attr_in_zones = None
        self._attr_location_name = None
        if state is None or state.state == STATE_UNAVAILABLE:
            self._attr_available = False
            self._attr_latitude = self._attr_longitude = None
            self._set_position(None)
            return
        self._attr_available = True
        friendly = state.attributes.get(ATTR_FRIENDLY_NAME)
        self._attr_name = f"{friendly or self._source} (Box Zones)"
        if friendly:
            self._name_subentry(friendly)
        lat = _coordinate(state.attributes.get(ATTR_LATITUDE))
        lon = _coordinate(state.attributes.get(ATTR_LONGITUDE))
        accuracy = next(
            (a for key in ACCURACY_ATTRIBUTES if (a := _coordinate(state.attributes.get(key))) is not None),
            None,
        )
        accuracy = accuracy if accuracy is not None and accuracy >= 0 else 0
        self._attr_location_accuracy = accuracy
        self._attr_latitude, self._attr_longitude = lat, lon
        if lat is None or lon is None:
            self._set_position(None)
            self._pass_through(state)
            return
        self._warned_no_position = False
        self._set_position((friendly or self._source, lat, lon))

        boxes = find_zones(self._store.zones, lat, lon)
        if not boxes:
            return  # Home Assistant picks home / not_home / a round zone from the position
        # A box wins over the round zone the tracker is in only if it is smaller.
        round_zone = zone.async_active_zone(self.hass, lat, lon, accuracy)
        box_radius = equivalent_radius(boxes[0])
        if round_zone is None or box_radius < float(round_zone.attributes.get("radius") or 0):
            self._box = boxes[0]
        if SUPPORTS_IN_ZONES:
            box_ids = [eid for b in boxes if (eid := box_entity_id(self.hass, b["id"]))]
            round_ids = list(zone.async_in_zones(self.hass, lat, lon, accuracy)[1])
            self._attr_in_zones = box_ids + round_ids
        elif self._box is not None:
            self._attr_location_name = self._box["name"]

    @callback
    def _pass_through(self, state: State) -> None:
        """No position (for example a router-based tracker): copy what it says."""
        if not self._warned_no_position:
            _LOGGER.warning(
                "%s has no usable latitude/longitude (got %r, %r), so Box Zones can't "
                "tell which box it is in. Its state is passed through instead",
                self._source,
                state.attributes.get(ATTR_LATITUDE),
                state.attributes.get(ATTR_LONGITUDE),
            )
            self._warned_no_position = True
        if not SUPPORTS_IN_ZONES:
            self._attr_location_name = state.state
            return
        if isinstance(in_zones := state.attributes.get(ATTR_IN_ZONES), list):
            self._attr_in_zones = in_zones
        elif state.state == STATE_HOME:
            self._attr_in_zones = [zone.ENTITY_ID_HOME]
        elif state.state == STATE_NOT_HOME:
            self._attr_in_zones = []
        else:
            self._attr_in_zones = [
                z.entity_id for z in self.hass.states.async_all(zone.DOMAIN) if z.name == state.state
            ]

    @callback
    def _name_subentry(self, friendly: str) -> None:
        """A tracker added before its integration had loaded is titled by its entity ID: fix that."""
        sub = self._entry.subentries.get(self._subentry_id)
        if sub is not None and sub.title == self._source and self.hass is not None:
            self.hass.config_entries.async_update_subentry(self._entry, sub, title=friendly)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            ATTR_SOURCE: self._source,
            ATTR_BOX: self._box["name"] if self._box else None,
            ATTR_BOX_ID: self._box["id"] if self._box else None,
        }
