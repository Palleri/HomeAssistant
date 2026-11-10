"""Constants for Box Zones."""

from __future__ import annotations

DOMAIN = "box_zones"
VERSION = "0.4.2"

CONF_TRACKERS = "trackers"
CONF_ENTITY_ID = "entity_id"
SUBENTRY_TRACKER = "tracker"

STORAGE_KEY = "box_zones.zones"
# Major version 2: boxes have a shape (ADR 0001). Older Box Zones refuse to load it
# instead of dropping boxes they don't understand.
STORAGE_VERSION = 2

PANEL_URL_PATH = "box-zones"
PANEL_TITLE = "Box Zones"
PANEL_ICON = "mdi:vector-square"
PANEL_ELEMENT = "box-zones-panel"
STATIC_URL = "/box_zones_static"

# Sent with the zone list whenever a box is saved or deleted.
SIGNAL_ZONES_UPDATED = f"{DOMAIN}_zones_updated"
# A box entity appeared or went away: the location entities re-evaluate.
SIGNAL_BOX_ENTITIES_UPDATED = f"{DOMAIN}_box_entities_updated"
# A followed tracker moved: the box entities recount who is inside.
SIGNAL_POSITIONS_UPDATED = f"{DOMAIN}_positions_updated"

ENTITY_SUFFIX = "_box_zones"
