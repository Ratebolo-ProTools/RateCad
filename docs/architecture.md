# RateCAD Architecture (Milestone 1)

## Product

RateCAD is a standalone desktop CAD application:

**AutoCAD-style 2D drafting + AI command interface + construction intelligence.**

RateBolo is not connected in this repository.

## Source of truth

`DrawingDocument` in `@ratecad/core` owns all geometry.

- Renderer (`@ratecad/viewport`) is a projection only.
- Tools emit commands; they do not mutate the document directly.
- Future AI must emit the same commands onto `CommandBus`.

```
Prompt → AI → Validated commands → CommandBus → DrawingDocument → Viewport
```

## Packages

| Package | Milestone 1 status |
|---------|--------------------|
| core | Document + Line/Rectangle/Circle entities |
| geometry | Vec2 math, snap, hit helpers |
| commands | Create/Delete + undo/redo bus |
| tools | Select, Line, Rect, Circle, Pan sessions |
| viewport | Camera, grid, Canvas2D renderer, hit-test |
| io | `.ratecad` JSON serialize/parse |
| ai | Stub boundary only |
| quantities | Stub |
| integration-api | Stub contracts for future RateBolo |

## Desktop shell

`apps/desktop` — Electron + React + Vite. Packages do not depend on Electron.
