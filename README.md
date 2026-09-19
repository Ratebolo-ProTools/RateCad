# RateCAD

Standalone desktop CAD application for civil engineers, architects, and draftsmen.

**RateCAD = AutoCAD-style 2D drafting + AI command/prompt interface + construction intelligence.**

This repository is independent of RateBolo. Future integration will happen only through `@ratecad/integration-api`.

## Milestone 1

Professional CAD workspace shell with:

- Electron desktop shell
- Dark drafting UI (viewport, tools, properties, status bar)
- Line / Rectangle / Circle drawing
- Select, delete, undo / redo
- Zoom, pan, grid, coordinates, units

## Development

```bash
pnpm install
pnpm --filter @ratecad/desktop dev
```

## Packages

| Package | Role |
|---------|------|
| `@ratecad/core` | DrawingDocument source of truth |
| `@ratecad/geometry` | 2D math kernel |
| `@ratecad/commands` | Command bus + undo/redo |
| `@ratecad/tools` | Interactive drawing tools |
| `@ratecad/viewport` | Camera + Canvas renderer |
| `@ratecad/io` | `.ratecad` persistence |
| `@ratecad/ai` | AI boundary (stub) |
| `@ratecad/quantities` | Quantities (stub) |
| `@ratecad/integration-api` | Future RateBolo contracts (stub) |
