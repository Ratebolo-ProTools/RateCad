# RateCAD Command Engine V2

## Overview

Command Engine V2 is the central AutoCAD-style interaction layer for RateCAD.

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
| `packages/tools/src/commandEngine/commands/*` | LINE, RECTANGLE, CIRCLE, MOVE, COPY |
| `packages/tools/src/cadCommands.ts` | Legacy simple registry (still exported) |

## Lifecycle

1. `engine.start('REC')` or `engine.start('rectangle')` (toolbar)
2. Command `start()` returns the first prompt
3. User provides points (mouse/snap) or typed input
4. `onMove` updates preview only (document untouched)
5. Commit executes existing `*Command` classes via `CommandBus`
6. Escape → cancel, restore Select, discard preview
7. Empty Enter after a completed command → repeat last command

## Input types

`point | distance | length | angle | integer | decimal | string | boolean | option | entity | entities`

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
| C | CIRCLE | Center + radius (mouse or typed) |
| PL | POLYLINE | Hands off to existing tool |
| M | MOVE | Selection → base → second point |
| CO | COPY | Selection → base → second point |
| TR EX O MI RO SC | TRIM…SCALE | Activate existing canvas tools |

**Keys:** Enter / Space confirm · Escape cancel · Tab autocomplete · ↑↓ history
