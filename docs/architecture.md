# RateCAD Architecture

## Product

RateCAD is a standalone desktop CAD application:

**AutoCAD-style 2D drafting + AI command interface + construction intelligence.**

RateBolo is not connected in this repository. AI is not implemented yet.

## Source of truth

`DrawingDocument` in `@ratecad/core` owns all geometry and construction entities.

```
DrawingDocument
      ↓
CommandBus
      ↓
Construction object model (Wall / Door / Window / Room)
      ↓
Geometry kernel (derived plan symbols + room topology)
      ↓
Viewport renderer (projection-only)
```

- Renderer (`@ratecad/viewport`) is a projection only.
- Tools emit commands; they do not mutate the document directly.
- Future AI must emit the same commands onto `CommandBus`.

```
Prompt → AI → Validated commands → CommandBus → DrawingDocument → Viewport
```

## Construction model

| Entity | Authority | Relationships |
|--------|-----------|---------------|
| Wall | start/end, thickness, height, justification | — |
| Door | hostWallId, position ∈ [0,1], width, swing | → Wall |
| Window | hostWallId, position, width, sill | → Wall |
| Room | wallIds + wallDirs (closed loop), name, type | → Walls; doors/windows via host walls |

Rooms do not store duplicate wall geometry. Moving a boundary wall recalculates
room polygon/area. Broken loops remove the room rather than leaving stale data.

## Packages

| Package | Role |
|---------|------|
| core | Document, layers, Wall/Door/Window/Room + CAD entities |
| geometry | Math, snap, construction layouts, room topology/queries |
| commands | Create/Update/Delete + modify + undo/redo bus |
| tools | Interactive tool sessions |
| viewport | Camera, grid, Canvas2D renderer, hit-test, grips |
| io | `.ratecad` JSON serialize/parse + schema migration |
| ai | Stub boundary only |
| quantities | Stub |
| integration-api | Stub contracts for future RateBolo |

## Desktop shell

`apps/desktop` — Electron + React + Vite. Packages do not depend on Electron.

## File format

- Extension: `.ratecad`
- Current schema version: **4**
- Migrations: v1/v2/v3 → v4
