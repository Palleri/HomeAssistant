# Box Zones

Zones you draw on a map for Home Assistant, shaped as rectangles or polygons, that
tell you which one a followed tracker is in.

## Language

### Boxes

**Box**:
A named place drawn on the Box Zones map. Every box has a shape: a rectangle or a polygon.
_Avoid_: Zone, area, shape (as the name for the whole thing)

**Rectangle**:
A box with four square corners, set by its middle, width, height and turn.
_Avoid_: Square, rect

**Polygon**:
A box whose outline is any number of corners (3 to 100) joined by straight sides,
which may be concave but never crosses itself.
_Avoid_: Poly, freeform, area

**Corner**:
One point of a polygon's outline.
_Avoid_: Vertex, node, point

**Turn**:
How far a rectangle is rotated, in degrees clockwise from east-west. Polygons have no turn.
_Avoid_: Rotation, angle, heading

### Trackers and entities

**Followed tracker**:
A Home Assistant device tracker that Box Zones watches.
_Avoid_: Device, source

**Location entity**:
The tracker that Box Zones adds next to each followed tracker; it shows the box
the tracker is in, or what the followed tracker itself shows.
_Avoid_: Mirror, proxy tracker

**Box entity**:
The sensor every box gets, counting the followed trackers inside it. The same
for rectangles and polygons.
_Avoid_: Polygon sensor, zone sensor

**Round zone**:
One of Home Assistant's own circular zones, such as Home.
_Avoid_: Zone (on its own), HA zone
