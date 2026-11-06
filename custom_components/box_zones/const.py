"""Constants for Box Zones."""

from __future__ import annotations

DOMAIN = "box_zones"
VERSION = "0.1.0"

CONF_TRACKERS = "trackers"

STORAGE_KEY = "box_zones.zones"
STORAGE_VERSION = 1

PANEL_URL_PATH = "box-zones"
PANEL_TITLE = "Box Zones"
PANEL_ICON = "mdi:vector-square"
PANEL_ELEMENT = "box-zones-panel"
STATIC_URL = "/box_zones_static"

# Sent with the zone list whenever a box is saved or deleted.
SIGNAL_ZONES_UPDATED = f"{DOMAIN}_zones_updated"

ENTITY_SUFFIX = "_box_zones"
