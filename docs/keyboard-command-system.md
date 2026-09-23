# Keyboard Command + Selection System

Extends **Command Engine V2** — does not replace it.

## Architecture

```
USER (mouse / keyboard)
        │
 Input / Interaction (App + KeyboardContext)
        │
 ┌──────┼──────────────┐
 ▼      ▼              ▼
Selection  Command     AI classifier
Manager    Registry    (NL only)
 │         │           │
 └─────────┼───────────┘
           ▼
    CadCommandEngine (V2)
           ▼
     CAD Geometry / Tools
```

## Modules

| File | Role |
|------|------|
| `registry.ts` | Ranked `suggestRanked` (alias/name/keyword/typo/usage) |
| `usage.ts` | Recent + frequency tracker |
| `keyboardContext.ts` | CAD_CANVAS vs TEXT_EDITOR / DIALOG / … |
| `inputClassifier.ts` | CAD token vs numeric vs natural language |
| `selectionManager.ts` | Selection set + hover |
| `engine.ts` | ESC state machine, confirm via highlight, NL hook |
| `commands/erase.ts` | ERASE (E / DEL) |

## ESC

1. Cancel active command (rollback preview; no commit)
2. Clear command buffer / suggestions
3. Clear selection → Pointer/Select

## Default mode

App boots in **select** (pointer). Drawing tools activate only when chosen.

## Aliases (RateCAD registry)

L LINE · PL POLYLINE · C CIRCLE · REC RECTANGLE · M MOVE · CO/CP COPY · MI MIRROR · RO ROTATE · SC SCALE · TR TRIM · EX EXTEND · O OFFSET · E ERASE · AA AREA · DIM DIMENSION · …

Conflicts throw at register time.

## Dynamic Input

Near-cursor panel shows active command prompt/options or ranked suggestions while typing.
