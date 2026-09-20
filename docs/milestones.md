# Milestones

## Milestone 7 (current) — Rooms & Spaces Foundation

Semantic RoomEntity bounded by WallEntity loops.

### Behavior notes

- **RoomEntity**: wallIds + wallDirs are authoritative; polygon/area are
  derived caches recalculated when boundary walls move/rotate/grip-edit.
- **Detection**: deterministic left-hand face walk on wall endpoint graph.
  Click inside a closed loop creates a room (smallest containing loop).
  Open networks and clicks outside loops are rejected with a clear message.
- **Delete wall**: Cascades hosted doors/windows **and** rooms that used
  that wall (invalid rooms are not left behind).
- **Queries**: `findRooms`, `findWallsForRoom`, `findDoorsForRoom`,
  `findWindowsForRoom`, `findRoomsContainingPoint`, `findAffectedRoomsForWall`.
- **Scale / Copy / Mirror of rooms**: restricted — rooms follow walls.
- **Schema**: `.ratecad` schema **v4** with Rooms layer. v1–v3 migrate on open.

## Milestone 6 — Construction Objects Foundation

Walls, doors, windows with host relationships; schema v3.

## Milestone 5 — Annotations & layers

Dimensions, text, leaders, unit handling, schema v2.

## Milestone 4 — CAD modify

Trim, Extend, Offset, Mirror, Rotate, Scale.

## Milestone 3 — Selection & grips

Editable grips, Move/Copy, multi-select, window selection.

## Milestone 2 — Canvas hardening

Polyline, SnapEngine, New/Open/Save, keyboard workflow.

## Milestone 1 — Foundation

DrawingDocument, CommandBus, Canvas2D viewport, core packages.
