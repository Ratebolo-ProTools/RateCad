# RateCAD Command Engine V2 / V2.1

## Overview

Command Engine V2 is the central AutoCAD-style interaction layer for RateCAD.
V2.1 polishes the five core commands (LINE, RECTANGLE, CIRCLE, MOVE, COPY)
with proper selection, repeated COPY, defaults, Ortho/Polar tracking, and
richer dynamic input.

```
Keyboard / Toolbar / Command line
        ↓
    CadCommandEngine
        ↓
CadEngineCommand (definition)
        ↓
Prompts → Parsers → Preview
        ↓
CommandBus → DrawingDocument
```

Toolbar buttons, keyboard aliases, and the command line **all start the same
`CadEngineCommand`**. There is no second geometry implementation.

## Key modules

| Module | Role |
|--------|------|
| `packages/tools/src/commandEngine/registry.ts` | Command + alias registry, autocomplete |
| `packages/tools/src/commandEngine/engine.ts` | Session / confirm / cancel / pointer |
| `packages/tools/src/commandEngine/parsers.ts` | Point, distance, angle, options |
| `packages/tools/src/commandEngine/history.ts` | Session command history |
| `packages/tools/src/commandEngine/commands/*` | LINE, RECTANGLE, CIRCLE, MOVE, COPY, AREA |
| `packages/geometry/src/polarTracking.ts` | Ortho / Polar direction constraints |
| `packages/tools/src/cadCommands.ts` | Legacy simple registry (still exported) |

## Lifecycle

1. `engine.start('REC')` or `engine.start('rectangle')` (toolbar)
2. Command `start()` returns the first prompt
3. User provides points (mouse/snap) or typed input
4. `onMove` updates preview only (document untouched)
5. Commit executes existing `*Command` classes via `CommandBus`
6. Escape → cancel, restore Select, discard preview
7. Empty Enter after a completed command → repeat last command
   (never when an HTML property/text field is focused)

## MOVE workflow (V2.1)

```
M / Enter
→ Select objects:          (canvas selection / window / crossing)
→ Enter / Space            (finish selection)
→ Specify base point:
→ Specify second point:    (live preview; document unchanged)
→ click / typed point      → MoveEntitiesCommand
```

Escape at any stage cancels without mutating the document.

## COPY workflow (V2.1)

```
CO / Enter
→ Select objects: → Enter
→ Specify base point:
→ Specify second point:    → CopyEntitiesCommand (copy 1)
→ Specify second point:    → copy 2, copy 3, …
→ Enter / Exit             → finish COPY
```

Each copy is a separate CommandBus entry (Undo removes one copy at a time).

## CIRCLE defaults

The CIRCLE command owns `defaultValue` on the radius prompt
(`Specify radius <5.00>:`). Empty Enter accepts the default via the engine.
Invalid / zero / negative radius stays on the radius prompt.

## Polar tracking / Ortho

`PolarTrackingEngine` (`@ratecad/geometry`) constrains cursor direction:

| Mode | Behavior |
|------|----------|
| Ortho ON (F8) | Prefer horizontal / vertical |
| Polar ON (F10) | Snap to increment (90° default, optional 45° diagonals) |
| Typed `<angle>` / coords | Always win over visual tracking |

Right-click Polar toolbar button cycles 90° ↔ 45° increment.

## Input types

`point | distance | length | angle | integer | decimal | string | boolean | option | entity | entities`

`entities` = selection phase (MOVE/COPY). Canvas input routes to the existing
selection system; Enter finishes selection.

## Point syntax

| Input | Meaning |
|-------|---------|
| `10,20` | Absolute Cartesian |
| `@10,20` | Relative Cartesian from last point |
| `10<45` | Absolute polar from origin |
| `@10<45` | Relative polar from last point |
| `<30` | Angle override (degrees) |
| `10` | Direct distance along cursor (or override) |

Uses existing `parseLengthInput` / drawing units.

## Options / defaults

Prompts may declare options, e.g. `[Length/Width]` or `[Undo]`.
Typed `L` / `Length` selects an option via `matchOption`.
Defaults appear as `<value>`; empty Enter accepts the default when set.
Commands own their `defaultValue` — do not hard-code in App.tsx.

## Adding a new command

1. Implement `CadEngineCommand` in `commandEngine/commands/`
2. Register it in `createDefaultEngineRegistry()`
3. Execute geometry only through `@ratecad/commands` CommandBus classes
4. Add unit tests in `commandEngine.test.ts`

Do **not** add command-specific branches to `App.tsx` keyboard handlers.

## Transparent commands

`CadEngineCommand.transparent` is reserved for future read-only nested
operations (e.g. query while LINE is active). Nested mutation is not enabled.

## User command reference

| Alias | Command | Notes |
|-------|---------|-------|
| L | LINE | Multi-segment; Undo option; coords / direct distance / angle |
| REC, RECT | RECTANGLE | Free / Length / Width; dock fields still work |
| C | CIRCLE | Center + radius; default `<5.00>` |
| PL | POLYLINE | Hands off to existing tool |
| M | MOVE | Select → Enter → base → destination |
| CO | COPY | Select → Enter → base → repeated destinations → Enter |
| TR EX O MI RO SC | TRIM…SCALE | Activate existing canvas tools |

**Keys:** Enter / Space confirm · Escape cancel · Tab autocomplete · ↑↓ history · F3 Snap · F8 Ortho · F10 Polar
