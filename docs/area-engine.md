# RateCAD Area Measurement Engine

Professional AutoCAD-style area / perimeter measurement built on RateCAD’s
canonical model-space geometry. UI, Room tools, reports, and AI helpers all call
the **same** deterministic engines — never hatch pixels, screen coordinates, or
LLM arithmetic.

## Architecture

```
RateCAD UI / AREA tool / Command Engine V2 / AI
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
   Object Area   Point Area   Pick Inside
       │            │            │
       └────────────┼────────────┘
                    ▼
             Boundary Engine
                    │
                    ▼
               Area Engine
                    │
                    ▼
           Unit Engine (display only)
```

### Packages

| Module | Role |
|--------|------|
| `packages/geometry/src/areaEngine.ts` | Shoelace / circle / entity area, `AreaSession` add/subtract, formatters |
| `packages/geometry/src/boundaryEngine.ts` | Segment collect → intersect split → loop walk → holes → pick-inside |
| `packages/tools/src/areaTool.ts` | AREA tool modes, preview, Create Boundary / Label |
| `packages/tools/src/commandEngine/commands/area.ts` | `AREA` / `AA` / `MEASUREGEOM` handoff |
| `packages/ai/src/index.ts` | `parseAiAreaIntent` + `executeAiAreaQuery` (engine only) |

## AREA tool modes

| Mode | Behavior |
|------|----------|
| **Object** | Select closed rectangle / circle / polyline / room |
| **Points** | Click vertices; live preview; Enter finishes (closes last→first) |
| **Pick Inside** | Interior click → boundary graph / wall loop / circle |
| **Add / Subtract** | Running `AreaSession` net total |
| **Room** | Pick inside room / wall loop; uses room name when present |

## Results

`AreaResult` always includes:

- `area` / `perimeter` in **world** square / linear units
- `outer` + `holes` (model polygons for highlight)
- `outerArea` / `holesArea` / `calculationMethod` / `warnings`
- `perimeterKind: 'boundary-sum'` (explicit; not union exterior)

Display uses `formatWorldArea` / `formatWorldLength` — changing display units
never mutates geometry. Area conversion squares the linear mm-hub factor.

## Open / self-intersecting

- Open polyline → explicit prompt: Close Temporarily / Create Boundary / Cancel
- Self-intersecting → `Cannot calculate area: Boundary is self-intersecting.`

## Limitations

- Ellipse / spline / arc-bulge polylines are not first-class entity types yet;
  unsupported types return clear errors (no silent wrong area).
- Associative permanent labels for arbitrary polylines store a text snapshot;
  **rooms** remain the associative source of truth (recalculated from walls).
- Combined external perimeter of a boolean union is not implemented; use
  Boundary Perimeter (sum) labels.

## References (behavioral)

Autodesk AREA, MEASUREGEOM, BOUNDARY / HATCH island docs — behavioral reference
only; RateCAD code is original.
