# Bump the storage major version when polygons arrive

Versions before polygons drop any box they can't validate when they load, and the
next save then deletes it for good, so a downgrade would quietly lose every polygon.
We bump the box storage from version 1 to 2 (a major version, not a minor one).
Home Assistant then refuses to load the newer file in an old Box Zones and leaves
it untouched, so going back fails loudly and upgrading again brings every box back.

## Considered Options

- **Minor version bump**: old versions still load the file, so polygons are lost.
- **No bump**: same as the minor bump.
