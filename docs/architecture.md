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
Construction object model (Wall / Door / Window)
      ↓
Geometry kernel (derived plan symbols)
      ↓
Viewport renderer (projection-only)
```

- Renderer (`@ratecad/viewport`) is a projection only.
- Tools emit commands; they do not mutate the document directly.
- Future AI must emit the same commands onto `CommandBus`.

```
Prompt → AI → Validated commands → CommandBus → DrawingDocument → Viewport
```

## Construction model (Milestone 6)

| Entity | Authority | Host |
|--------|-----------|------|
| Wall | start/end, thickness, height, justification, material | — |
| Door | hostWallId, position ∈ [0,1], width, height, swing | Wall |
| Window | hostWallId, position ∈ [0,1], width, height, sill | Wall |

Doors and windows are never flattened into anonymous lines/arcs in the document.
Openings are derived when rendering the host wall outline.

## Packages

| Package | Role |
|---------|------|
| core | Document, layers, Wall/Door/Window + legacy CAD entities |
| geometry | Math, snap, construction layouts, transforms |
| commands | Create/Update/Delete + modify + undo/redo bus |
| tools | Interactive tool sessions (Wall/Door/Window + CAD) |
| viewport | Camera, grid, Canvas2D renderer, hit-test, grips |
| io | `.ratecad` JSON serialize/parse + schema migration |
| ai | Stub boundary only |
| quantities | Stub |
| integration-api | Stub contracts for future RateBolo |

## Desktop shell

`apps/desktop` — Electron + React + Vite. Packages do not depend on Electron.

## File format

- Extension: `.ratecad`
- Current schema version: **3**
- Migrations: v1 → v3, v2 → v3 (adds annotation layers, dimensionStyle,
  constructionDefaults, Walls/Doors/Windows layers)
