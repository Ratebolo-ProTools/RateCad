/**
 * Continuous DIM and non-persistent QUICKMEASURE.
 * MEASUREGEOM stays the AREA alias. D stays DIMSTYLE. DIST stays the two-point measure.
 */

import { CreateDimensionCommand, type CommandBus } from '@ratecad/commands';
import { getActiveDimensionStyle, getCurrentLayer, type DimensionEntity, type LengthUnit, type Vec2 } from '@ratecad/core';
import {
  angularDraft,
  ccwSweep,
  describeHover,
  dimensionMeasuredValue,
  formatAngleByDrawingUnits,
  formatAngleDegrees,
  formatDimensionLength,
  linearDimensionDraft,
  nearestLinearTarget,
  nearestRadialTarget,
  pointOnCircle,
  radialDimensionDraft,
  threePointAngle,
  type DimensionDraft,
  type LinearDimMode,
  type LinearTarget,
  type RadialTarget,
} from '@ratecad/geometry';
import { matchOption } from '../parsers.js';
import type {
  CadCommandContext,
  CadEngineCommand,
  CadPromptDefinition,
} from '../types.js';

type DimMode =
  | 'smart'
  | 'linear'
  | 'aligned'
  | 'angular'
  | 'radius'
  | 'diameter'
  | 'arc'
  | 'continue'
  | 'baseline';

type DimPhase = 'select' | 'second' | 'place' | 'angle-line' | 'angle-p2' | 'angle-p3';

interface DimState {
  bus: CommandBus;
  mode: DimMode;
  phase: DimPhase;
  forceKind?: 'horizontal' | 'vertical';
  undoAtStart: number;
  first?: Vec2;
  lockedLinear?: LinearTarget;
  lockedPoints?: { start: Vec2; end: Vec2 };
  lockedRadial?: RadialTarget;
  lockedArc?: RadialTarget;
  angleLine?: LinearTarget;
  angleSecond?: LinearTarget;
  angleVertex?: Vec2;
  angleRay?: Vec2;
}

interface DimSpec {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  mode: DimMode;
  forceKind?: 'horizontal' | 'vertical';
}

const UNDO_OPTION = { id: 'undo', label: 'Undo', aliases: ['U', 'UNDO'] };

function prompt(id: string, message: string): CadPromptDefinition {
  return { id, message, inputType: 'point', options: [UNDO_OPTION] };
}

function selectMessage(mode: DimMode): string {
  switch (mode) {
    case 'smart':
      return 'Select object or specify first extension line origin';
    case 'linear':
      return 'Select line or specify first extension line origin';
    case 'aligned':
      return 'Select object to align, or specify first extension line origin';
    case 'angular':
      return 'Select arc, line, or specify angle vertex';
    case 'radius':
      return 'Select circle or arc';
    case 'diameter':
      return 'Select circle or arc';
    case 'arc':
      return 'Select arc';
    case 'continue':
    case 'baseline':
      return 'Specify next extension line origin';
  }
}

function asState(state: Record<string, unknown>): DimState {
  return state as unknown as DimState;
}

function linearMode(state: DimState): LinearDimMode {
  if (state.mode === 'aligned') return 'aligned';
  if (state.mode === 'linear') return 'linear';
  return 'smart';
}

function resetPick(state: DimState): void {
  delete state.first;
  delete state.lockedLinear;
  delete state.lockedPoints;
  delete state.lockedRadial;
  delete state.lockedArc;
  delete state.angleLine;
  delete state.angleSecond;
  delete state.angleVertex;
  delete state.angleRay;
  state.phase = 'select';
}

function sameEdge(a: LinearTarget, b: LinearTarget): boolean {
  return a.entityId === b.entityId && a.edgeIndex === b.edgeIndex;
}

function withBinding(draft: DimensionDraft | null, binding?: Record<string, unknown>): DimensionDraft | null {
  if (!draft || !binding) return draft;
  return { ...draft, metadata: { ...(draft.metadata ?? {}), ...binding } };
}

function trimNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(8).replace(/\.?0+$/, '');
}

function formatDraft(doc: ReturnType<CommandBus['getDocument']>, worldUnit: LengthUnit, draft: DimensionDraft): string {
  const style = getActiveDimensionStyle(
    doc.settings.dimensionStyles ?? [],
    doc.settings.activeDimensionStyleName ?? 'Standard',
  );
  const value = dimensionMeasuredValue(
    {
      kind: draft.kind,
      start: draft.start,
      end: draft.end,
      offset: draft.offset,
      ...(draft.vertex ? { vertex: draft.vertex } : {}),
    },
    draft.metadata,
  );
  if (draft.kind === 'angular') {
    const units = doc.settings.drawingUnits;
    const formatted = units
      ? formatAngleByDrawingUnits(value, units.angularFormat, units.angularPrecision)
      : formatAngleDegrees(value, style.primary.precision);
    return `${formatted} (${trimNumber(value)})`;
  }
  const prefix = draft.kind === 'radius' ? 'R' : draft.kind === 'diameter' ? 'Ø' : '';
  const formatted = formatDimensionLength(value, worldUnit, style, { kindPrefix: prefix });
  const body = draft.kind === 'arc-length' ? `Arc ${formatted}` : formatted;
  return `${body} (${trimNumber(value)})`;
}

function lastLinearDimension(doc: ReturnType<CommandBus['getDocument']>): DimensionEntity | null {
  for (let index = doc.entities.length - 1; index >= 0; index -= 1) {
    const entity = doc.entities[index];
    if (
      entity?.type === 'dimension' &&
      (entity.geometry.kind === 'horizontal' ||
        entity.geometry.kind === 'vertical' ||
        entity.geometry.kind === 'aligned')
    ) {
      return entity;
    }
  }
  return null;
}

function baselineSpacing(doc: ReturnType<CommandBus['getDocument']>): number {
  const style = getActiveDimensionStyle(
    doc.settings.dimensionStyles ?? [],
    doc.settings.activeDimensionStyleName ?? 'Standard',
  );
  return Math.max(style.text.height * 2, 0.25);
}

function continueDraft(
  previous: DimensionEntity,
  point: Vec2,
  baseline: boolean,
  spacing: number,
): DimensionDraft | null {
  const kind = previous.geometry.kind;
  if (kind !== 'horizontal' && kind !== 'vertical' && kind !== 'aligned') return null;
  const origin = baseline ? previous.geometry.start : previous.geometry.end;
  if (Math.hypot(point.x - origin.x, point.y - origin.y) < 1e-9) return null;
  const sign = Math.sign(previous.geometry.offset || 1);
  const offset = baseline ? previous.geometry.offset + sign * spacing : previous.geometry.offset;
  return { kind, start: { ...origin }, end: { ...point }, offset };
}

function arcAngleDraft(target: RadialTarget, cursor: Vec2): DimensionDraft | null {
  if (target.startAngle == null || target.endAngle == null) return null;
  const sweep = ccwSweep(target.startAngle, target.endAngle);
  const placeRadius = Math.max(
    Math.hypot(cursor.x - target.center.x, cursor.y - target.center.y),
    target.radius * 0.2,
  );
  return {
    kind: 'angular',
    start: pointOnCircle(target.center, placeRadius, target.startAngle),
    end: pointOnCircle(target.center, placeRadius, target.startAngle + sweep),
    offset: 0,
    vertex: { ...target.center },
    metadata: {
      useCcw: true,
      modelDimension: {
        role: 'angular',
        entityId: target.entityId,
        valid: true,
      },
    },
  };
}

function radialRequest(state: DimState, target: RadialTarget, cursor: Vec2): 'smart' | 'radius' | 'diameter' | 'arc' {
  if (state.mode === 'radius') return 'radius';
  if (state.mode === 'diameter') return 'diameter';
  if (state.mode === 'arc') return 'arc';
  if (target.kind === 'arc') {
    const fromCenter = Math.hypot(cursor.x - target.center.x, cursor.y - target.center.y);
    if (fromCenter >= target.radius * 0.85) return 'arc';
  }
  return 'smart';
}

function hoverDraft(state: DimState, point: Vec2): DimensionDraft | null {
  const entities = state.bus.getDocument().entities;
  const linear = nearestLinearTarget(entities, point);
  const radial = nearestRadialTarget(entities, point);
  if (state.mode === 'angular') {
    if (radial?.kind === 'arc') return arcAngleDraft(radial, point);
    return null;
  }
  if (state.mode === 'radius' || state.mode === 'diameter' || state.mode === 'arc') {
    if (!radial) return null;
    const request = radialRequest(state, radial, point);
    return withBinding(radialDimensionDraft(radial, point, request), undefined);
  }
  if (linear && (state.mode === 'smart' || state.mode === 'linear' || state.mode === 'aligned')) {
    return linearDimensionDraft(linear.start, linear.end, point, linearMode(state), state.forceKind);
  }
  if (radial && state.mode === 'smart') {
    const request = radialRequest(state, radial, point);
    return radialDimensionDraft(radial, point, request);
  }
  return null;
}

function draftFor(state: DimState, point: Vec2): DimensionDraft | null {
  if (state.mode === 'continue' || state.mode === 'baseline') {
    const previous = lastLinearDimension(state.bus.getDocument());
    if (!previous) return null;
    return continueDraft(
      previous,
      point,
      state.mode === 'baseline',
      baselineSpacing(state.bus.getDocument()),
    );
  }
  if (state.phase === 'place' && state.lockedLinear) {
    return withBinding(
      linearDimensionDraft(
        state.lockedLinear.start,
        state.lockedLinear.end,
        point,
        linearMode(state),
        state.forceKind,
      ),
      {
        modelDimension: {
          role: 'linear',
          entityId: state.lockedLinear.entityId,
          edgeIndex: state.lockedLinear.edgeIndex,
          valid: true,
        },
      },
    );
  }
  if (state.phase === 'place' && state.lockedPoints) {
    return linearDimensionDraft(
      state.lockedPoints.start,
      state.lockedPoints.end,
      point,
      linearMode(state),
      state.forceKind,
    );
  }
  if (state.phase === 'place' && state.lockedRadial) {
    const request = radialRequest(state, state.lockedRadial, point);
    const draft = radialDimensionDraft(state.lockedRadial, point, request);
    if (!draft) return null;
    const role = draft.kind === 'arc-length' ? 'arc' : draft.kind === 'diameter' ? 'diameter' : 'radius';
    return withBinding(draft, {
      modelDimension: {
        role,
        entityId: state.lockedRadial.entityId,
        directionAngle: draft.metadata?.directionAngle,
        valid: true,
      },
    });
  }
  if (state.phase === 'place' && state.lockedArc) return arcAngleDraft(state.lockedArc, point);
  if (state.phase === 'place' && state.angleLine && state.angleSecond) {
    const wedge = angularDraft(
      state.angleLine.start,
      state.angleLine.end,
      state.angleSecond.start,
      state.angleSecond.end,
      point,
    );
    if (!wedge) return null;
    return {
      kind: 'angular',
      start: wedge.start,
      end: wedge.end,
      offset: 0,
      vertex: wedge.vertex,
      metadata: {
        useCcw: true,
        modelDimension: {
          role: 'angular',
          entityId: state.angleLine.entityId,
          edgeIndex: state.angleLine.edgeIndex,
          secondEntityId: state.angleSecond.entityId,
          secondEdgeIndex: state.angleSecond.edgeIndex,
          valid: true,
        },
      },
    };
  }
  if (state.phase === 'angle-p3' && state.angleVertex && state.angleRay) {
    const angle = threePointAngle(state.angleVertex, state.angleRay, point);
    if (!angle) return null;
    return {
      kind: 'angular',
      start: angle.start,
      end: angle.end,
      offset: 0,
      vertex: angle.vertex,
    };
  }
  if (state.phase === 'angle-line' && state.angleLine) {
    const second = nearestLinearTarget(state.bus.getDocument().entities, point);
    if (!second || sameEdge(state.angleLine, second)) return null;
    const wedge = angularDraft(
      state.angleLine.start,
      state.angleLine.end,
      second.start,
      second.end,
      point,
    );
    if (!wedge) return null;
    return {
      kind: 'angular',
      start: wedge.start,
      end: wedge.end,
      offset: 0,
      vertex: wedge.vertex,
      metadata: { useCcw: true },
    };
  }
  if (state.phase === 'select') return hoverDraft(state, point);
  return null;
}

function toPreview(draft: DimensionDraft, layerId: string): DimensionEntity {
  return {
    id: 'preview-dim',
    type: 'dimension',
    layerId,
    visible: true,
    locked: false,
    geometry: {
      kind: draft.kind,
      start: draft.start,
      end: draft.end,
      offset: draft.offset,
      ...(draft.vertex ? { vertex: draft.vertex } : {}),
    },
    properties: {},
    ...(draft.metadata ? { metadata: draft.metadata } : {}),
  };
}

function createDimensionCommand(spec: DimSpec): CadEngineCommand {
  const selectPrompt = () => prompt('select', selectMessage(spec.mode));

  return {
    id: spec.id,
    name: spec.name,
    aliases: spec.aliases,
    description: spec.description,
    tool: 'dimension',
    category: 'Annotate',
    keywords: ['dimension', 'dim', spec.mode, 'measure'],
    bootstrap: (bus) => ({ state: { undoAtStart: bus.getUndoDepth() } }),
    start: () => ({
      prompt: selectPrompt(),
      status: `${spec.name}: ${selectMessage(spec.mode)}`,
      state: {
        mode: spec.mode,
        phase: 'select',
        ...(spec.forceKind ? { forceKind: spec.forceKind } : {}),
      },
    }),
    onText: (text, current, _ctx, raw) => {
      const state = asState(raw);
      if (!text.trim()) {
        return {
          kind: 'reject',
          message: 'Press Esc or right-click to cancel',
          prompt: current,
        };
      }
      const option = matchOption(text, current.options);
      if (option.ok && option.optionId === 'undo') {
        if (state.bus.canUndo() && state.bus.getUndoDepth() > (state.undoAtStart ?? 0)) {
          state.bus.undo();
          return {
            kind: 'continue',
            prompt: current,
            status: `${spec.name}: Undid last dimension`,
            message: 'Undid last dimension',
          };
        }
        return { kind: 'reject', message: 'Nothing to undo', prompt: current };
      }
      return { kind: 'reject', message: 'Specify a point or select an object', prompt: current };
    },
    onPoint: (point, current, ctx, raw) => {
      const state = asState(raw);
      const fail = (message: string) => ({ kind: 'reject' as const, message, prompt: current });
      const placed = (draft: DimensionDraft) => {
        try {
          state.bus.execute(
            new CreateDimensionCommand(
              draft.kind,
              draft.start,
              draft.end,
              draft.offset,
              undefined,
              undefined,
              draft.vertex,
              draft.metadata ? { metadata: draft.metadata } : undefined,
            ),
          );
        } catch {
          return fail('Cannot create that dimension');
        }
        const label = formatDraft(state.bus.getDocument(), ctx.worldUnit, draft);
        resetPick(state);
        return {
          kind: 'continue' as const,
          prompt: selectPrompt(),
          committed: true,
          status: `${spec.name}: ${label} — select next`,
          message: label,
          preview: null,
        };
      };

      if (state.mode === 'continue' || state.mode === 'baseline') {
        const draft = draftFor(state, point);
        if (!draft) return fail('No linear dimension to continue');
        return placed(draft);
      }

      if (state.phase === 'place' || state.phase === 'angle-p3') {
        const draft = draftFor(state, point);
        if (!draft) return fail('Dimension is degenerate — move the cursor and try again');
        return placed(draft);
      }

      if (state.phase === 'second' && state.first) {
        if (Math.hypot(point.x - state.first.x, point.y - state.first.y) < 1e-9) {
          return fail('Points are identical');
        }
        state.lockedPoints = { start: { ...state.first }, end: { ...point } };
        delete state.first;
        state.phase = 'place';
        return {
          kind: 'continue',
          prompt: prompt('place', 'Specify dimension line location'),
          status: `${spec.name}: Specify dimension line location`,
          lastPoint: point,
        };
      }

      if (state.phase === 'angle-line' && state.angleLine) {
        const second = nearestLinearTarget(state.bus.getDocument().entities, point);
        if (!second || sameEdge(state.angleLine, second)) return fail('Select a second line');
        if (!angularDraft(state.angleLine.start, state.angleLine.end, second.start, second.end, point)) {
          return fail('Lines are parallel, collinear, or too short');
        }
        state.angleSecond = second;
        state.phase = 'place';
        return {
          kind: 'continue',
          prompt: prompt('place', 'Specify dimension arc location'),
          status: `${spec.name}: Specify dimension arc location`,
        };
      }

      if (state.phase === 'angle-p2' && state.angleVertex) {
        if (Math.hypot(point.x - state.angleVertex.x, point.y - state.angleVertex.y) < 1e-9) {
          return fail('Angle endpoint is on the vertex');
        }
        state.angleRay = { ...point };
        state.phase = 'angle-p3';
        return {
          kind: 'continue',
          prompt: prompt('angle3', 'Specify second angle endpoint'),
          status: `${spec.name}: Specify second angle endpoint`,
          lastPoint: point,
        };
      }

      const entities = state.bus.getDocument().entities;
      const linear = nearestLinearTarget(entities, point);
      const radial = nearestRadialTarget(entities, point);

      if (state.mode === 'angular') {
        if (radial?.kind === 'arc') {
          state.lockedArc = radial;
          state.phase = 'place';
          return {
            kind: 'continue',
            prompt: prompt('place', 'Specify dimension arc location'),
            status: `${spec.name}: Specify dimension arc location`,
          };
        }
        if (linear) {
          state.angleLine = linear;
          state.phase = 'angle-line';
          return {
            kind: 'continue',
            prompt: prompt('angle2', 'Select second line'),
            status: `${spec.name}: Select second line`,
          };
        }
        state.angleVertex = { ...point };
        state.phase = 'angle-p2';
        return {
          kind: 'continue',
          prompt: prompt('angle-p2', 'Specify first angle endpoint'),
          status: `${spec.name}: Specify first angle endpoint`,
          lastPoint: point,
        };
      }

      if (state.mode === 'radius' || state.mode === 'diameter' || state.mode === 'arc') {
        if (!radial) return fail('Select a circle or arc');
        if (state.mode === 'arc' && radial.kind !== 'arc') return fail('Arc length requires an arc');
        state.lockedRadial = radial;
        state.phase = 'place';
        return {
          kind: 'continue',
          prompt: prompt('place', 'Specify dimension line location'),
          status: `${spec.name}: Specify dimension line location`,
        };
      }

      if (linear) {
        state.lockedLinear = linear;
        state.phase = 'place';
        return {
          kind: 'continue',
          prompt: prompt('place', 'Specify dimension line location'),
          status: `${spec.name}: Specify dimension line location`,
        };
      }
      if (radial && state.mode === 'smart') {
        state.lockedRadial = radial;
        state.phase = 'place';
        return {
          kind: 'continue',
          prompt: prompt('place', 'Specify dimension line location'),
          status: `${spec.name}: Specify dimension line location`,
        };
      }

      state.first = { ...point };
      state.phase = 'second';
      return {
        kind: 'continue',
        prompt: prompt('second', 'Specify second extension line origin'),
        status: `${spec.name}: Specify second extension line origin`,
        lastPoint: point,
      };
    },
    onMove: (point, _current, ctx, raw) => {
      const state = asState(raw);
      if (state.phase === 'second' && state.first) {
        return {
          preview: { kind: 'line', start: state.first, end: point },
          previewEntities: null,
          dynamic: { distance: Math.hypot(point.x - state.first.x, point.y - state.first.y) },
        };
      }
      const draft = draftFor(state, point);
      if (!draft) {
        return { preview: null, previewEntities: null, dynamic: null };
      }
      const layerId = getCurrentLayer(state.bus.getDocument()).id;
      const value = dimensionMeasuredValue(
        {
          kind: draft.kind,
          start: draft.start,
          end: draft.end,
          offset: draft.offset,
          ...(draft.vertex ? { vertex: draft.vertex } : {}),
        },
        draft.metadata,
      );
      return {
        preview: null,
        previewEntities: [toPreview(draft, layerId)],
        dynamic: draft.kind === 'angular'
          ? { angleDeg: value, label: 'Angle' }
          : { distance: value, label: draft.kind === 'radius' ? 'Radius' : 'Dimension' },
        status: `${spec.name}: ${formatDraft(state.bus.getDocument(), ctx.worldUnit, draft)}`,
      };
    },
  };
}

export const dimensionCommands: CadEngineCommand[] = [
  createDimensionCommand({
    id: 'dimension',
    name: 'DIM',
    aliases: [],
    description: 'Create dimensions until cancelled',
    mode: 'smart',
  }),
  createDimensionCommand({
    id: 'dimlinear',
    name: 'DIMLINEAR',
    aliases: ['DLI'],
    description: 'Horizontal or vertical dimension',
    mode: 'linear',
  }),
  createDimensionCommand({
    id: 'dimaligned',
    name: 'DIMALIGNED',
    aliases: ['DAL'],
    description: 'Aligned dimension',
    mode: 'aligned',
  }),
  createDimensionCommand({
    id: 'dimangular',
    name: 'DIMANGULAR',
    aliases: ['DAN'],
    description: 'Angular dimension',
    mode: 'angular',
  }),
  createDimensionCommand({
    id: 'dimradius',
    name: 'DIMRADIUS',
    aliases: ['DRA'],
    description: 'Radius dimension',
    mode: 'radius',
  }),
  createDimensionCommand({
    id: 'dimdiameter',
    name: 'DIMDIAMETER',
    aliases: ['DDI'],
    description: 'Diameter dimension',
    mode: 'diameter',
  }),
  createDimensionCommand({
    id: 'dimarc',
    name: 'DIMARC',
    aliases: ['DAR'],
    description: 'Arc length dimension',
    mode: 'arc',
  }),
  createDimensionCommand({
    id: 'dimcontinue',
    name: 'DIMCONTINUE',
    aliases: ['DCO'],
    description: 'Continue a linear dimension',
    mode: 'continue',
  }),
  createDimensionCommand({
    id: 'dimbaseline',
    name: 'DIMBASELINE',
    aliases: ['DBA'],
    description: 'Baseline linear dimension',
    mode: 'baseline',
  }),
  createDimensionCommand({
    id: 'dimhorizontal',
    name: 'DIMHORIZONTAL',
    aliases: [],
    description: 'Force a horizontal dimension',
    mode: 'linear',
    forceKind: 'horizontal',
  }),
  createDimensionCommand({
    id: 'dimvertical',
    name: 'DIMVERTICAL',
    aliases: [],
    description: 'Force a vertical dimension',
    mode: 'linear',
    forceKind: 'vertical',
  }),
];

type MeasureMode = 'quick' | 'distance' | 'angle' | 'radius' | 'area';

interface MeasureState {
  bus: CommandBus;
  mode: MeasureMode;
  points: Vec2[];
}

const MEASURE_OPTIONS = [
  { id: 'quick', label: 'Quick', aliases: ['Q', 'QUICK'] },
  { id: 'distance', label: 'Distance', aliases: ['D', 'DIST'] },
  { id: 'angle', label: 'Angle', aliases: ['A', 'ANGLE'] },
  { id: 'radius', label: 'Radius', aliases: ['R', 'RADIUS'] },
  { id: 'area', label: 'Area', aliases: ['AR', 'AREA'] },
];

function measurePrompt(message: string): CadPromptDefinition {
  return { id: 'measure', message, inputType: 'point', options: MEASURE_OPTIONS };
}

/** Hover and click measurement. Does not create dimension entities. */
export const quickMeasureCommand: CadEngineCommand = {
  id: 'quick-measure',
  name: 'QUICKMEASURE',
  aliases: ['QM', 'MEASURE'],
  description: 'Measure distance, angle, radius, or area without creating a dimension',
  tool: 'select',
  category: 'Measure',
  keywords: ['measure', 'distance', 'radius', 'area', 'quick'],
  start: () => ({
    prompt: measurePrompt('Hover to measure, or pick points. Esc to exit'),
    status: 'QUICKMEASURE: Hover to measure',
    state: { mode: 'quick', points: [] },
  }),
  onText: (text, current, _ctx, raw) => {
    const state = raw as unknown as MeasureState;
    if (!text.trim()) {
      return { kind: 'reject', message: 'Press Esc or right-click to cancel', prompt: current };
    }
    const option = matchOption(text, current.options);
    if (!option.ok) return { kind: 'reject', message: option.error, prompt: current };
    state.mode = option.optionId as MeasureMode;
    state.points = [];
    return {
      kind: 'continue',
      prompt: current,
      status: `QUICKMEASURE: ${option.optionId}`,
      message: option.optionId,
    };
  },
  onPoint: (point, current, _ctx, raw) => {
    const state = raw as unknown as MeasureState;
    const entities = state.bus.getDocument().entities;
    const report = (label: string, distance?: number, angleDeg?: number) => ({
      kind: 'continue' as const,
      prompt: current,
      status: label,
      message: label,
      dynamic: {
        ...(distance != null ? { distance } : {}),
        ...(angleDeg != null ? { angleDeg } : {}),
        label: 'Measure',
      },
    });

    if (state.mode === 'radius') {
      const radial = nearestRadialTarget(entities, point);
      if (!radial) return { kind: 'reject', message: 'Select a circle or arc', prompt: current };
      return report(`R ${trimNumber(radial.radius)}  Ø ${trimNumber(radial.radius * 2)}`, radial.radius);
    }
    if (state.mode === 'area') {
      const hover = describeHover(entities, point);
      if (!hover || !hover.label.startsWith('Area')) {
        return { kind: 'reject', message: 'Pick inside a closed shape', prompt: current };
      }
      return report(hover.label, hover.distance);
    }
    if (state.mode === 'angle') {
      state.points = [...state.points, { ...point }];
      if (state.points.length < 3) {
        return {
          kind: 'continue',
          prompt: current,
          status: state.points.length === 1
            ? 'QUICKMEASURE: Specify first ray point'
            : 'QUICKMEASURE: Specify second ray point',
          lastPoint: point,
        };
      }
      const [vertex, first, second] = state.points;
      state.points = [];
      const angle = vertex && first && second ? threePointAngle(vertex, first, second) : null;
      if (!angle) return { kind: 'reject', message: 'Angle is degenerate', prompt: current };
      return report(`Angle ${trimNumber(angle.degrees)}°`, undefined, angle.degrees);
    }
    if (state.mode === 'distance') {
      state.points = [...state.points, { ...point }];
      if (state.points.length < 2) {
        return {
          kind: 'continue',
          prompt: current,
          status: 'QUICKMEASURE: Specify second point',
          lastPoint: point,
        };
      }
      const [first, second] = state.points;
      state.points = [];
      if (!first || !second) return { kind: 'reject', message: 'Specify a point', prompt: current };
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const length = Math.hypot(dx, dy);
      return report(
        `Distance ${trimNumber(length)}  ΔX ${trimNumber(dx)}  ΔY ${trimNumber(dy)}`,
        length,
      );
    }

    const hover = describeHover(entities, point);
    if (hover) return report(hover.label, hover.distance, hover.angleDeg);
    state.mode = 'distance';
    state.points = [{ ...point }];
    return {
      kind: 'continue',
      prompt: current,
      status: 'QUICKMEASURE: Specify second point',
      lastPoint: point,
    };
  },
  onMove: (point, _current, _ctx, raw) => {
    const state = raw as unknown as MeasureState;
    const entities = state.bus.getDocument().entities;
    const hover = describeHover(entities, point);
    const first = state.points[0];
    if ((state.mode === 'distance' || state.mode === 'quick') && state.points.length === 1 && first) {
      return {
        preview: { kind: 'line', start: first, end: point },
        dynamic: { distance: Math.hypot(point.x - first.x, point.y - first.y), label: 'Measure' },
        status: `Distance ${trimNumber(Math.hypot(point.x - first.x, point.y - first.y))}`,
      };
    }
    if (!hover) return { preview: null, dynamic: null };
    return {
      preview: null,
      dynamic: { distance: hover.distance, label: 'Measure' },
      status: hover.label,
    };
  },
};

function measureModeCommand(
  id: string,
  name: string,
  aliases: string[],
  mode: MeasureMode,
  message: string,
): CadEngineCommand {
  return {
    ...quickMeasureCommand,
    id,
    name,
    aliases,
    description: message,
    start: () => ({
      prompt: measurePrompt(message),
      status: `QUICKMEASURE: ${message}`,
      state: { mode, points: [] },
    }),
  };
}

/** Non-persistent angle and radius measure. These do not create dimension entities. */
export const measureModeCommands: CadEngineCommand[] = [
  measureModeCommand('measure-angle', 'MEASUREANGLE', ['QMA'], 'angle', 'Specify vertex, then two points'),
  measureModeCommand('measure-radius', 'MEASURERADIUS', ['QMR'], 'radius', 'Select a circle or arc'),
];
