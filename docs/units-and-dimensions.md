# RateCAD Units & Dimension System

## Internal unit

Geometry coordinates and linear properties are stored in the document’s
**`settings.worldUnit`** (canonical storage).

- New and legacy drawings default to **`worldUnit: 'ft'`** (international foot).
- Millimeters are the **interchange hub** for all conversions (`MM_PER`).
- Changing **display** units never rewrites geometry.

Physical equivalents are always recoverable, e.g. `10 ft` ↔ `3048 mm`.

## Supported display units (`settings.units`)

| Code | Label |
|------|--------|
| `in` | Inches |
| `ft-in` | Feet & Inches (architectural) |
| `ft` | Feet (decimal) |
| `m` | Meters |
| `cm` | Centimeters |
| `mm` | Millimeters |

## Exact conversion constants

```
1 in = 25.4 mm = 2.54 cm = 0.0254 m
1 ft = 12 in = 304.8 mm = 30.48 cm = 0.3048 m
1 m  = 1000 mm = 100 cm
```

API (package `@ratecad/geometry`):

- `convertLength` / `convertArea` / `convertVolume`
- `toMillimeters` / `fromMillimeters`
- `formatWorldLength` / `formatArchitecturalFeet`
- `parseLength` / `parseArchitecturalLength` / `parseLengthInput`
- `worldToDisplay` / `displayToWorld`

## Precision

- **Decimal units:** `settings.precision` ∈ {0,1,2,3,4}
- **Feet & Inches:** `settings.fractionDenominator` ∈ {1,2,4,8,16,32}

Precision affects **display only**. Internal geometry is unchanged.

## Dimension formatting

Linear (horizontal / vertical / aligned), radius (`R …`), diameter (`Ø …`),
and angular (`…°`) dimensions derive values from geometry every frame.
Dimension entities do **not** store a fake editable measurement string.

## Display vs geometry conversion

| Operation | Command | Effect |
|-----------|---------|--------|
| Change display units | `SetDrawingUnitsCommand` | Format only; undoable |
| Scale / import convert | `ConvertDrawingWorldUnitCommand` | Scales all linear geometry + updates `worldUnit` |

## AI unit parsing

`@ratecad/ai` exposes helpers (no LLM yet):

- `parseAiLength` — “10 feet”, `3'-4"`, `3.5 m`, …
- `parseAiDisplayUnitChange` — “change units to meters”
- `parseAiWorldUnitConversion` — “convert drawing to millimeters”

AI must modify geometry via CommandBus, never dimension text.

## Saved metadata

```json
{
  "settings": {
    "worldUnit": "ft",
    "units": "ft-in",
    "precision": 2,
    "fractionDenominator": 16,
    "gridSize": 1
  }
}
```

Schema v5 migrates older files: legacy `units: "ft"` → display `ft-in`,
`worldUnit: "ft"`, without scaling geometry.

## Tests

See `packages/geometry/src/unitEngine.test.ts` and updated `units.test.ts`.
