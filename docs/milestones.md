# Milestones

## Milestone 6 (current) — Construction Objects Foundation

Structured walls, doors, and windows with host relationships.

### Behavior notes

- **Semantic entities**: `WallEntity`, `DoorEntity`, `WindowEntity` are first-class
  document types. Plan geometry is derived from parameters (not stored as lines).
- **Hosting**: Doors/windows store `hostWallId` + parametric `position` along the
  wall. Moving/rotating a wall does not rewrite hosted records; world placement
  follows the host automatically.
- **Delete wall**: Cascades — hosted doors/windows are deleted with the wall
  (via `DeleteWallCommand` / `DeleteEntitiesCommand` + `expandDeleteIds`).
  Undo restores the wall and hosted elements together. Orphans are filtered on
  `.ratecad` open.
- **Scale**: Explicitly **disabled** for walls/doors/windows. Scaling thickness
  or height silently would produce incorrect construction data.
- **Wall joining**: Basic endpoint cleanup only — joined ends omit caps and
  slightly extend side faces. Full architectural wall cleanup is future work.
- **Layers**: Walls → Walls layer, Doors → Doors, Windows → Windows. Locked
  layers block modification.
- **Schema**: `.ratecad` schema **v3** with `constructionDefaults`. v1/v2
  documents migrate on open.

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
