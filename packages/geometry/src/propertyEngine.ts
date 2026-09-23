/**
 * PropertyEngine — resolve ByLayer inheritance, validate, and describe
 * editable properties. Mutations go through @ratecad/commands so undo works.
 */

import {
  appearanceFromCurrent,
  BY_LAYER_COLOR,
  BY_LAYER_LINETYPE,
  BY_LAYER_LINEWEIGHT,
  BY_LAYER_TRANSPARENCY,
  DEFAULT_CURRENT_APPEARANCE,
  getLayer,
  getLinetypeDefinition,
  hexToRgb,
  LINEWEIGHT_REGISTRY_MM,
  LINETYPE_REGISTRY,
  NAMED_COLORS,
  nearestLineweightMm,
  normalizeColorProperty,
  normalizeLinetypeProperty,
  normalizeLineweightProperty,
  normalizeTransparencyProperty,
  parseColorInput,
  rgbToHex,
  scaleLinetypePattern,
  type AppearanceProperties,
  type ColorProperty,
  type CurrentAppearance,
  type DrawingDocument,
  type EffectiveAppearance,
  type Entity,
  type Layer,
  type LayerId,
  type LinetypeProperty,
  type LineweightProperty,
  type RgbColor,
  type TransparencyProperty,
  type Vec2,
} from '@ratecad/core';

export {
  appearanceFromCurrent,
  BY_LAYER_COLOR,
  BY_LAYER_LINETYPE,
  BY_LAYER_LINEWEIGHT,
  BY_LAYER_TRANSPARENCY,
  DEFAULT_CURRENT_APPEARANCE,
  hexToRgb,
  LINEWEIGHT_REGISTRY_MM,
  LINETYPE_REGISTRY,
  NAMED_COLORS,
  nearestLineweightMm,
  parseColorInput,
  rgbToHex,
};

export type PropertyCategory = 'general' | 'geometry' | 'current';

export type PropertyDataType =
  | 'string'
  | 'number'
  | 'length'
  | 'angle'
  | 'area'
  | 'color'
  | 'linetype'
  | 'lineweight'
  | 'transparency'
  | 'layer'
  | 'boolean'
  | 'enum';

export interface PropertyDescriptor {
  key: string;
  label: string;
  category: PropertyCategory;
  dataType: PropertyDataType;
  editable: boolean;
  multiEditable?: boolean;
  options?: Array<{ label: string; value: string }>;
}

export interface StoredAppearanceView {
  color: ColorProperty;
  linetype: LinetypeProperty;
  linetypeScale: number;
  lineweight: LineweightProperty;
  transparency: TransparencyProperty;
  layerId: LayerId;
}

export interface ResolvedPropertyPair {
  stored: StoredAppearanceView;
  effective: EffectiveAppearance;
}

function layerColorRgb(layer: Layer | undefined, fallback: string): RgbColor {
  const hex = layer?.color ?? fallback;
  return hexToRgb(hex) ?? { type: 'RGB', r: 212, g: 212, b: 212 };
}

/**
 * Resolve stored semantic appearance → effective display values.
 * Does NOT mutate the entity.
 */
export function resolveEffectiveAppearance(
  entity: Entity,
  doc: DrawingDocument,
  themeFallback = '#d4d4d4',
): EffectiveAppearance {
  const layer = getLayer(doc, entity.layerId);
  const props = (entity.properties ?? {}) as AppearanceProperties;
  const color = normalizeColorProperty(props.color);
  const linetype = normalizeLinetypeProperty(props.linetype);
  const lineweight = normalizeLineweightProperty(
    props.lineweight ?? props.lineWeight,
  );
  const transparency = normalizeTransparencyProperty(props.transparency);
  const objectLtScale =
    typeof props.linetypeScale === 'number' && Number.isFinite(props.linetypeScale)
      ? props.linetypeScale
      : 1;
  const globalLtScale =
    typeof doc.settings.linetypeScale === 'number' &&
    Number.isFinite(doc.settings.linetypeScale)
      ? doc.settings.linetypeScale
      : 1;

  let colorRgb: RgbColor;
  if (color.mode === 'EXPLICIT') {
    colorRgb = color.value;
  } else {
    colorRgb = layerColorRgb(layer, themeFallback);
  }

  let linetypeId: string;
  if (linetype.mode === 'EXPLICIT') {
    linetypeId = linetype.value;
  } else {
    linetypeId = layer?.linetype ?? 'Continuous';
  }
  const ltDef = getLinetypeDefinition(linetypeId);
  const pattern = scaleLinetypePattern(
    ltDef.pattern,
    objectLtScale,
    globalLtScale,
  );

  let lineweightMm: number;
  if (lineweight.mode === 'EXPLICIT') {
    lineweightMm = lineweight.value;
  } else {
    lineweightMm = layer?.lineweight ?? 0.25;
  }

  let transparencyPct: number;
  if (transparency.mode === 'EXPLICIT') {
    transparencyPct = transparency.value;
  } else {
    transparencyPct = layer?.transparency ?? 0;
  }

  return {
    colorHex: rgbToHex(colorRgb),
    colorRgb,
    linetypeId: ltDef.id,
    linetypePattern: pattern,
    linetypeScale: objectLtScale,
    lineweightMm,
    transparency: transparencyPct,
    alpha: Math.max(0, Math.min(1, 1 - transparencyPct / 100)),
  };
}

export function getStoredAppearance(entity: Entity): StoredAppearanceView {
  const props = (entity.properties ?? {}) as AppearanceProperties;
  return {
    color: normalizeColorProperty(props.color),
    linetype: normalizeLinetypeProperty(props.linetype),
    linetypeScale:
      typeof props.linetypeScale === 'number' && Number.isFinite(props.linetypeScale)
        ? props.linetypeScale
        : 1,
    lineweight: normalizeLineweightProperty(
      props.lineweight ?? props.lineWeight,
    ),
    transparency: normalizeTransparencyProperty(props.transparency),
    layerId: entity.layerId,
  };
}

export function resolvePropertyPair(
  entity: Entity,
  doc: DrawingDocument,
): ResolvedPropertyPair {
  return {
    stored: getStoredAppearance(entity),
    effective: resolveEffectiveAppearance(entity, doc),
  };
}

export interface AppearancePatch {
  layerId?: LayerId;
  color?: ColorProperty;
  linetype?: LinetypeProperty;
  linetypeScale?: number;
  lineweight?: LineweightProperty;
  transparency?: TransparencyProperty;
}

export function applyAppearancePatch(
  entity: Entity,
  patch: AppearancePatch,
): Entity {
  const next = structuredClone(entity) as Entity;
  if (patch.layerId) next.layerId = patch.layerId;
  const props = { ...(next.properties as AppearanceProperties) };
  if (patch.color !== undefined) props.color = patch.color;
  if (patch.linetype !== undefined) props.linetype = patch.linetype;
  if (patch.linetypeScale !== undefined) {
    props.linetypeScale = Math.max(1e-6, patch.linetypeScale);
  }
  if (patch.lineweight !== undefined) {
    props.lineweight = patch.lineweight;
    delete props.lineWeight;
  }
  if (patch.transparency !== undefined) {
    props.transparency = patch.transparency;
  }
  (next as { properties: AppearanceProperties }).properties = props;
  return next;
}

export function setByLayerPatch(
  keys: Array<'color' | 'linetype' | 'lineweight' | 'transparency'>,
): AppearancePatch {
  const patch: AppearancePatch = {};
  for (const k of keys) {
    if (k === 'color') patch.color = { mode: 'BY_LAYER' };
    if (k === 'linetype') patch.linetype = { mode: 'BY_LAYER' };
    if (k === 'lineweight') patch.lineweight = { mode: 'BY_LAYER' };
    if (k === 'transparency') patch.transparency = { mode: 'BY_LAYER' };
  }
  return patch;
}

export function matchPropPatch(
  source: Entity,
  keys: Array<
    | 'layer'
    | 'color'
    | 'linetype'
    | 'linetypeScale'
    | 'lineweight'
    | 'transparency'
  > = [
    'layer',
    'color',
    'linetype',
    'linetypeScale',
    'lineweight',
    'transparency',
  ],
): AppearancePatch {
  const stored = getStoredAppearance(source);
  const patch: AppearancePatch = {};
  for (const k of keys) {
    if (k === 'layer') patch.layerId = stored.layerId;
    if (k === 'color') patch.color = stored.color;
    if (k === 'linetype') patch.linetype = stored.linetype;
    if (k === 'linetypeScale') patch.linetypeScale = stored.linetypeScale;
    if (k === 'lineweight') patch.lineweight = stored.lineweight;
    if (k === 'transparency') patch.transparency = stored.transparency;
  }
  return patch;
}

export function isLayerLocked(doc: DrawingDocument, layerId: LayerId): boolean {
  return getLayer(doc, layerId)?.locked === true;
}

export function canEditEntityProperties(
  entity: Entity,
  doc: DrawingDocument,
): boolean {
  if (entity.locked) return false;
  if (isLayerLocked(doc, entity.layerId)) return false;
  return true;
}

export function commonValue<T>(
  values: T[],
  equal: (a: T, b: T) => boolean = (a, b) => a === b,
): T | null | undefined {
  if (values.length === 0) return undefined;
  const first = values[0]!;
  for (let i = 1; i < values.length; i += 1) {
    if (!equal(first, values[i]!)) return null;
  }
  return first;
}

export function colorEqual(a: ColorProperty, b: ColorProperty): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === 'EXPLICIT' && b.mode === 'EXPLICIT') {
    return (
      a.value.r === b.value.r &&
      a.value.g === b.value.g &&
      a.value.b === b.value.b
    );
  }
  return true;
}

export function formatColorLabel(c: ColorProperty): string {
  if (c.mode === 'BY_LAYER') return 'ByLayer';
  if (c.mode === 'BY_BLOCK') return 'ByBlock';
  return rgbToHex(c.value).toUpperCase();
}

export function formatLinetypeLabel(l: LinetypeProperty): string {
  if (l.mode === 'BY_LAYER') return 'ByLayer';
  if (l.mode === 'BY_BLOCK') return 'ByBlock';
  return l.value;
}

export function formatLineweightLabel(l: LineweightProperty): string {
  if (l.mode === 'BY_LAYER') return 'ByLayer';
  if (l.mode === 'BY_BLOCK') return 'ByBlock';
  return `${l.value.toFixed(2)} mm`;
}

export function formatTransparencyLabel(t: TransparencyProperty): string {
  if (t.mode === 'BY_LAYER') return 'ByLayer';
  if (t.mode === 'BY_BLOCK') return 'ByBlock';
  return `${t.value}%`;
}

const GENERAL_DESCRIPTORS: PropertyDescriptor[] = [
  {
    key: 'layer',
    label: 'Layer',
    category: 'general',
    dataType: 'layer',
    editable: true,
    multiEditable: true,
  },
  {
    key: 'color',
    label: 'Color',
    category: 'general',
    dataType: 'color',
    editable: true,
    multiEditable: true,
  },
  {
    key: 'linetype',
    label: 'Linetype',
    category: 'general',
    dataType: 'linetype',
    editable: true,
    multiEditable: true,
  },
  {
    key: 'linetypeScale',
    label: 'Linetype Scale',
    category: 'general',
    dataType: 'number',
    editable: true,
    multiEditable: true,
  },
  {
    key: 'lineweight',
    label: 'Lineweight',
    category: 'general',
    dataType: 'lineweight',
    editable: true,
    multiEditable: true,
  },
  {
    key: 'transparency',
    label: 'Transparency',
    category: 'general',
    dataType: 'transparency',
    editable: true,
    multiEditable: true,
  },
];

const LINE_GEOMETRY: PropertyDescriptor[] = [
  { key: 'startX', label: 'Start X', category: 'geometry', dataType: 'length', editable: true },
  { key: 'startY', label: 'Start Y', category: 'geometry', dataType: 'length', editable: true },
  { key: 'endX', label: 'End X', category: 'geometry', dataType: 'length', editable: true },
  { key: 'endY', label: 'End Y', category: 'geometry', dataType: 'length', editable: true },
  { key: 'length', label: 'Length', category: 'geometry', dataType: 'length', editable: true },
  { key: 'angle', label: 'Angle', category: 'geometry', dataType: 'angle', editable: true },
];

const CIRCLE_GEOMETRY: PropertyDescriptor[] = [
  { key: 'centerX', label: 'Center X', category: 'geometry', dataType: 'length', editable: true },
  { key: 'centerY', label: 'Center Y', category: 'geometry', dataType: 'length', editable: true },
  { key: 'radius', label: 'Radius', category: 'geometry', dataType: 'length', editable: true },
  { key: 'diameter', label: 'Diameter', category: 'geometry', dataType: 'length', editable: true },
  { key: 'circumference', label: 'Circumference', category: 'geometry', dataType: 'length', editable: false },
  { key: 'area', label: 'Area', category: 'geometry', dataType: 'area', editable: false },
];

const POLYLINE_GEOMETRY: PropertyDescriptor[] = [
  { key: 'closed', label: 'Closed', category: 'geometry', dataType: 'boolean', editable: true },
  { key: 'vertexCount', label: 'Vertices', category: 'geometry', dataType: 'number', editable: false },
  { key: 'length', label: 'Length', category: 'geometry', dataType: 'length', editable: false },
  { key: 'area', label: 'Area', category: 'geometry', dataType: 'area', editable: false },
];

const ARC_GEOMETRY: PropertyDescriptor[] = [
  { key: 'centerX', label: 'Center X', category: 'geometry', dataType: 'length', editable: false },
  { key: 'centerY', label: 'Center Y', category: 'geometry', dataType: 'length', editable: false },
  { key: 'radius', label: 'Radius', category: 'geometry', dataType: 'length', editable: false },
  { key: 'startAngle', label: 'Start Angle', category: 'geometry', dataType: 'angle', editable: false },
  { key: 'endAngle', label: 'End Angle', category: 'geometry', dataType: 'angle', editable: false },
  { key: 'includedAngle', label: 'Included Angle', category: 'geometry', dataType: 'angle', editable: false },
  { key: 'arcLength', label: 'Arc Length', category: 'geometry', dataType: 'length', editable: false },
];

const GEOMETRY_REGISTRY: Record<string, PropertyDescriptor[]> = {
  line: LINE_GEOMETRY,
  circle: CIRCLE_GEOMETRY,
  polyline: POLYLINE_GEOMETRY,
  rectangle: [
    { key: 'corner1X', label: 'Corner1 X', category: 'geometry', dataType: 'length', editable: true },
    { key: 'corner1Y', label: 'Corner1 Y', category: 'geometry', dataType: 'length', editable: true },
    { key: 'corner2X', label: 'Corner2 X', category: 'geometry', dataType: 'length', editable: true },
    { key: 'corner2Y', label: 'Corner2 Y', category: 'geometry', dataType: 'length', editable: true },
    { key: 'width', label: 'Width', category: 'geometry', dataType: 'length', editable: false },
    { key: 'height', label: 'Height', category: 'geometry', dataType: 'length', editable: false },
  ],
  arc: ARC_GEOMETRY,
};

export function registerGeometryProperties(
  entityType: string,
  descriptors: PropertyDescriptor[],
): void {
  GEOMETRY_REGISTRY[entityType] = descriptors;
}

export function isArcPolyline(entity: Entity): boolean {
  return (
    entity.type === 'polyline' &&
    !!(entity.metadata && (entity.metadata as { arc?: unknown }).arc)
  );
}

export function getPropertyDescriptors(entity: Entity): PropertyDescriptor[] {
  if (isArcPolyline(entity)) {
    return [...GENERAL_DESCRIPTORS, ...(GEOMETRY_REGISTRY.arc ?? [])];
  }
  const geo = GEOMETRY_REGISTRY[entity.type] ?? [];
  return [...GENERAL_DESCRIPTORS, ...geo];
}

export function getGeneralPropertyDescriptors(): PropertyDescriptor[] {
  return [...GENERAL_DESCRIPTORS];
}

function polylineLength(vertices: Vec2[], closed: boolean): number {
  let len = 0;
  for (let i = 1; i < vertices.length; i += 1) {
    const a = vertices[i - 1]!;
    const b = vertices[i]!;
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (closed && vertices.length >= 2) {
    const a = vertices[vertices.length - 1]!;
    const b = vertices[0]!;
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

function polygonArea(vertices: Vec2[]): number {
  if (vertices.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function getGeometryPropertyValue(
  entity: Entity,
  key: string,
): number | boolean | string | null {
  if (entity.type === 'line') {
    const { start, end } = entity.geometry;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    switch (key) {
      case 'startX':
        return start.x;
      case 'startY':
        return start.y;
      case 'endX':
        return end.x;
      case 'endY':
        return end.y;
      case 'length':
        return length;
      case 'angle':
        return angle;
    }
  }
  if (entity.type === 'circle') {
    const { center, radius } = entity.geometry;
    switch (key) {
      case 'centerX':
        return center.x;
      case 'centerY':
        return center.y;
      case 'radius':
        return radius;
      case 'diameter':
        return radius * 2;
      case 'circumference':
        return 2 * Math.PI * radius;
      case 'area':
        return Math.PI * radius * radius;
    }
  }
  if (entity.type === 'polyline') {
    const arc = entity.metadata?.arc as
      | {
          center: Vec2;
          radius: number;
          startAngle: number;
          endAngle: number;
        }
      | undefined;
    if (
      arc &&
      (key.startsWith('center') ||
        key.includes('Angle') ||
        key === 'radius' ||
        key === 'arcLength' ||
        key === 'includedAngle')
    ) {
      const included =
        (arc.endAngle - arc.startAngle + Math.PI * 3) % (Math.PI * 2);
      switch (key) {
        case 'centerX':
          return arc.center.x;
        case 'centerY':
          return arc.center.y;
        case 'radius':
          return arc.radius;
        case 'startAngle':
          return (arc.startAngle * 180) / Math.PI;
        case 'endAngle':
          return (arc.endAngle * 180) / Math.PI;
        case 'includedAngle':
          return (included * 180) / Math.PI;
        case 'arcLength':
          return arc.radius * included;
      }
    }
    const { vertices, closed } = entity.geometry;
    switch (key) {
      case 'closed':
        return closed;
      case 'vertexCount':
        return vertices.length;
      case 'length':
        return polylineLength(vertices, closed);
      case 'area':
        return closed ? polygonArea(vertices) : 0;
    }
  }
  if (entity.type === 'rectangle') {
    const { corner1, corner2 } = entity.geometry;
    switch (key) {
      case 'corner1X':
        return corner1.x;
      case 'corner1Y':
        return corner1.y;
      case 'corner2X':
        return corner2.x;
      case 'corner2Y':
        return corner2.y;
      case 'width':
        return Math.abs(corner2.x - corner1.x);
      case 'height':
        return Math.abs(corner2.y - corner1.y);
    }
  }
  return null;
}

/**
 * Apply a geometry property edit.
 * Line length: preserve start + angle, move end.
 * Line angle: preserve start + length, move end.
 */
export function applyGeometryPropertyEdit(
  entity: Entity,
  key: string,
  value: number | boolean,
): Entity | null {
  const next = structuredClone(entity) as Entity;
  if (next.type === 'line') {
    const { start, end } = next.geometry;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    if (typeof value === 'number' && Number.isFinite(value)) {
      switch (key) {
        case 'startX':
          next.geometry.start.x = value;
          return next;
        case 'startY':
          next.geometry.start.y = value;
          return next;
        case 'endX':
          next.geometry.end.x = value;
          return next;
        case 'endY':
          next.geometry.end.y = value;
          return next;
        case 'length': {
          if (value <= 0) return null;
          next.geometry.end = {
            x: start.x + Math.cos(angle) * value,
            y: start.y + Math.sin(angle) * value,
          };
          return next;
        }
        case 'angle': {
          const rad = (value * Math.PI) / 180;
          const len = length > 1e-12 ? length : 1;
          next.geometry.end = {
            x: start.x + Math.cos(rad) * len,
            y: start.y + Math.sin(rad) * len,
          };
          return next;
        }
      }
    }
  }
  if (next.type === 'circle' && typeof value === 'number' && Number.isFinite(value)) {
    switch (key) {
      case 'centerX':
        next.geometry.center.x = value;
        return next;
      case 'centerY':
        next.geometry.center.y = value;
        return next;
      case 'radius':
        if (value <= 0) return null;
        next.geometry.radius = value;
        return next;
      case 'diameter':
        if (value <= 0) return null;
        next.geometry.radius = value / 2;
        return next;
    }
  }
  if (next.type === 'polyline' && key === 'closed' && typeof value === 'boolean') {
    next.geometry.closed = value;
    return next;
  }
  if (next.type === 'rectangle' && typeof value === 'number' && Number.isFinite(value)) {
    switch (key) {
      case 'corner1X':
        next.geometry.corner1.x = value;
        return next;
      case 'corner1Y':
        next.geometry.corner1.y = value;
        return next;
      case 'corner2X':
        next.geometry.corner2.x = value;
        return next;
      case 'corner2Y':
        next.geometry.corner2.y = value;
        return next;
    }
  }
  return null;
}

export function getCurrentAppearance(doc: DrawingDocument): CurrentAppearance {
  return doc.settings.currentAppearance ?? DEFAULT_CURRENT_APPEARANCE;
}

/** Build stored appearance for a newly created entity from CurrentProperties. */
export function appearanceForNewEntity(
  doc: DrawingDocument,
): AppearanceProperties {
  const cur = getCurrentAppearance(doc);
  return {
    color: structuredClone(cur.color),
    linetype: structuredClone(cur.linetype),
    linetypeScale: cur.linetypeScale,
    lineweight: structuredClone(cur.lineweight),
    transparency: structuredClone(cur.transparency),
  };
}

/** Convert mm lineweight to screen pixels (display only — geometry unchanged). */
export function lineweightToScreenPx(
  mm: number,
  _zoom: number,
  showLineweights: boolean,
  basePx = 1.25,
): number {
  if (!showLineweights || mm <= 0) return basePx;
  const px = Math.max(basePx, (mm / 0.25) * basePx);
  return Math.min(12, px);
}
