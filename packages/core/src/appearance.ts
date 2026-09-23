/**
 * CAD appearance / property model.
 *
 * Storage is semantic (BY_LAYER / BY_BLOCK / EXPLICIT).
 * Rendering must call PropertyEngine.resolve — never copy layer values into objects.
 */

export type PropertyMode = 'BY_LAYER' | 'BY_BLOCK' | 'EXPLICIT';

export interface RgbColor {
  type: 'RGB';
  r: number;
  g: number;
  b: number;
}

export type ColorProperty =
  | { mode: 'BY_LAYER' }
  | { mode: 'BY_BLOCK' }
  | { mode: 'EXPLICIT'; value: RgbColor };

export type LinetypeProperty =
  | { mode: 'BY_LAYER' }
  | { mode: 'BY_BLOCK' }
  | { mode: 'EXPLICIT'; value: string };

export type LineweightProperty =
  | { mode: 'BY_LAYER' }
  | { mode: 'BY_BLOCK' }
  | { mode: 'EXPLICIT'; value: number };

export type TransparencyProperty =
  | { mode: 'BY_LAYER' }
  | { mode: 'BY_BLOCK' }
  | { mode: 'EXPLICIT'; value: number };

/** Stored appearance fields on entities (plus type-specific extras). */
export interface AppearanceProperties {
  /**
   * Color — structured preferred; plain hex/rgb string = legacy EXPLICIT;
   * 'BYLAYER' / undefined = BY_LAYER.
   */
  color?: ColorProperty | string;
  linetype?: LinetypeProperty | string;
  linetypeScale?: number;
  /**
   * Lineweight in millimetres (plot/display).
   * Structured preferred; bare number = EXPLICIT; 'BYLAYER' / undefined = BY_LAYER.
   */
  lineweight?: LineweightProperty | number | string;
  /** @deprecated Prefer `lineweight`. Kept for older documents. */
  lineWeight?: number;
  transparency?: TransparencyProperty | number | string;
}

/** Current (default) properties for newly created objects. */
export interface CurrentAppearance {
  color: ColorProperty;
  linetype: LinetypeProperty;
  linetypeScale: number;
  lineweight: LineweightProperty;
  transparency: TransparencyProperty;
}

export const BY_LAYER_COLOR: ColorProperty = { mode: 'BY_LAYER' };
export const BY_LAYER_LINETYPE: LinetypeProperty = { mode: 'BY_LAYER' };
export const BY_LAYER_LINEWEIGHT: LineweightProperty = { mode: 'BY_LAYER' };
export const BY_LAYER_TRANSPARENCY: TransparencyProperty = { mode: 'BY_LAYER' };

export const DEFAULT_CURRENT_APPEARANCE: CurrentAppearance = {
  color: BY_LAYER_COLOR,
  linetype: BY_LAYER_LINETYPE,
  linetypeScale: 1,
  lineweight: BY_LAYER_LINEWEIGHT,
  transparency: BY_LAYER_TRANSPARENCY,
};

/** Named CAD colors (ACI-inspired subset). Values are RGB. */
export const NAMED_COLORS: Record<string, RgbColor> = {
  Red: { type: 'RGB', r: 255, g: 0, b: 0 },
  Yellow: { type: 'RGB', r: 255, g: 255, b: 0 },
  Green: { type: 'RGB', r: 0, g: 255, b: 0 },
  Cyan: { type: 'RGB', r: 0, g: 255, b: 255 },
  Blue: { type: 'RGB', r: 0, g: 0, b: 255 },
  Magenta: { type: 'RGB', r: 255, g: 0, b: 255 },
  White: { type: 'RGB', r: 255, g: 255, b: 255 },
  Black: { type: 'RGB', r: 0, g: 0, b: 0 },
};

export function rgbToHex(c: RgbColor): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function hexToRgb(hex: string): RgbColor | null {
  const s = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return {
      type: 'RGB',
      r: parseInt(s[0]! + s[0]!, 16),
      g: parseInt(s[1]! + s[1]!, 16),
      b: parseInt(s[2]! + s[2]!, 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return {
      type: 'RGB',
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    };
  }
  return null;
}

export function parseColorInput(input: string): ColorProperty | null {
  const t = input.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower === 'bylayer' || lower === 'by layer') {
    return { mode: 'BY_LAYER' };
  }
  if (lower === 'byblock' || lower === 'by block') {
    return { mode: 'BY_BLOCK' };
  }
  for (const [name, rgb] of Object.entries(NAMED_COLORS)) {
    if (name.toLowerCase() === lower) {
      return { mode: 'EXPLICIT', value: { ...rgb } };
    }
  }
  const rgbMatch = t.match(
    /^rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i,
  );
  if (rgbMatch) {
    return {
      mode: 'EXPLICIT',
      value: {
        type: 'RGB',
        r: Number(rgbMatch[1]),
        g: Number(rgbMatch[2]),
        b: Number(rgbMatch[3]),
      },
    };
  }
  const hex = hexToRgb(t.startsWith('#') ? t : `#${t}`);
  if (hex) return { mode: 'EXPLICIT', value: hex };
  return null;
}

export function normalizeColorProperty(
  raw: AppearanceProperties['color'],
): ColorProperty {
  if (raw == null) return { mode: 'BY_LAYER' };
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s || s.toUpperCase() === 'BYLAYER' || s.toUpperCase() === 'BY_LAYER') {
      return { mode: 'BY_LAYER' };
    }
    if (s.toUpperCase() === 'BYBLOCK' || s.toUpperCase() === 'BY_BLOCK') {
      return { mode: 'BY_BLOCK' };
    }
    const parsed = parseColorInput(s);
    if (parsed) return parsed;
    const hex = hexToRgb(s);
    if (hex) return { mode: 'EXPLICIT', value: hex };
    return { mode: 'BY_LAYER' };
  }
  if (raw.mode === 'EXPLICIT' && raw.value) {
    return {
      mode: 'EXPLICIT',
      value: {
        type: 'RGB',
        r: raw.value.r,
        g: raw.value.g,
        b: raw.value.b,
      },
    };
  }
  if (raw.mode === 'BY_BLOCK') return { mode: 'BY_BLOCK' };
  return { mode: 'BY_LAYER' };
}

export function normalizeLinetypeProperty(
  raw: AppearanceProperties['linetype'],
): LinetypeProperty {
  if (raw == null) return { mode: 'BY_LAYER' };
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s || s.toUpperCase() === 'BYLAYER' || s.toUpperCase() === 'BY_LAYER') {
      return { mode: 'BY_LAYER' };
    }
    if (s.toUpperCase() === 'BYBLOCK' || s.toUpperCase() === 'BY_BLOCK') {
      return { mode: 'BY_BLOCK' };
    }
    return { mode: 'EXPLICIT', value: s };
  }
  if (raw.mode === 'EXPLICIT' && raw.value) {
    return { mode: 'EXPLICIT', value: String(raw.value) };
  }
  if (raw.mode === 'BY_BLOCK') return { mode: 'BY_BLOCK' };
  return { mode: 'BY_LAYER' };
}

export function normalizeLineweightProperty(
  raw: AppearanceProperties['lineweight'] | AppearanceProperties['lineWeight'],
): LineweightProperty {
  if (raw == null) return { mode: 'BY_LAYER' };
  if (typeof raw === 'string') {
    const u = raw.toUpperCase();
    if (u === 'BYLAYER' || u === 'BY_LAYER') return { mode: 'BY_LAYER' };
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return { mode: 'EXPLICIT', value: raw };
  }
  if (typeof raw === 'object') {
    if (raw.mode === 'EXPLICIT' && typeof raw.value === 'number') {
      return { mode: 'EXPLICIT', value: raw.value };
    }
    if (raw.mode === 'BY_BLOCK') return { mode: 'BY_BLOCK' };
    if (raw.mode === 'BY_LAYER') return { mode: 'BY_LAYER' };
  }
  return { mode: 'BY_LAYER' };
}

export function normalizeTransparencyProperty(
  raw: AppearanceProperties['transparency'],
): TransparencyProperty {
  if (raw == null) return { mode: 'BY_LAYER' };
  if (typeof raw === 'string') {
    const u = raw.toUpperCase();
    if (u === 'BYLAYER' || u === 'BY_LAYER') return { mode: 'BY_LAYER' };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return {
      mode: 'EXPLICIT',
      value: Math.max(0, Math.min(100, Math.round(raw))),
    };
  }
  if (typeof raw === 'object') {
    if (raw.mode === 'EXPLICIT' && typeof raw.value === 'number') {
      return {
        mode: 'EXPLICIT',
        value: Math.max(0, Math.min(100, Math.round(raw.value))),
      };
    }
    if (raw.mode === 'BY_BLOCK') return { mode: 'BY_BLOCK' };
    if (raw.mode === 'BY_LAYER') return { mode: 'BY_LAYER' };
  }
  return { mode: 'BY_LAYER' };
}

/** Dash pattern in model units (positive = draw, negative = gap). Empty = Continuous. */
export interface LinetypeDefinition {
  id: string;
  name: string;
  pattern: number[];
}

export const LINETYPE_REGISTRY: readonly LinetypeDefinition[] = [
  { id: 'Continuous', name: 'Continuous', pattern: [] },
  { id: 'Dashed', name: 'Dashed', pattern: [0.5, -0.25] },
  { id: 'Dotted', name: 'Dotted', pattern: [0.05, -0.2] },
  { id: 'DashDot', name: 'DashDot', pattern: [0.5, -0.2, 0.05, -0.2] },
  { id: 'Center', name: 'Center', pattern: [1.25, -0.25, 0.25, -0.25] },
  { id: 'Hidden', name: 'Hidden', pattern: [0.35, -0.15] },
] as const;

export function getLinetypeDefinition(id: string): LinetypeDefinition {
  return (
    LINETYPE_REGISTRY.find(
      (l) => l.id.toLowerCase() === id.toLowerCase() || l.name.toLowerCase() === id.toLowerCase(),
    ) ?? LINETYPE_REGISTRY[0]!
  );
}

/** Standard lineweights in millimetres (ISO / AutoCAD-like). */
export const LINEWEIGHT_REGISTRY_MM: readonly number[] = [
  0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6,
  0.7, 0.8, 0.9, 1.0, 1.06, 1.2, 1.4, 1.58, 2.0, 2.11,
];

export function nearestLineweightMm(mm: number): number {
  let best = LINEWEIGHT_REGISTRY_MM[0]!;
  let bestDist = Math.abs(mm - best);
  for (const v of LINEWEIGHT_REGISTRY_MM) {
    const d = Math.abs(mm - v);
    if (d < bestDist) {
      best = v;
      bestDist = d;
    }
  }
  return best;
}

export function scaleLinetypePattern(
  pattern: number[],
  objectScale: number,
  globalScale: number,
): number[] {
  const s = Math.max(1e-9, objectScale * globalScale);
  return pattern.map((v) => v * s);
}

/** Effective (resolved) appearance for rendering. */
export interface EffectiveAppearance {
  colorHex: string;
  colorRgb: RgbColor;
  linetypeId: string;
  linetypePattern: number[];
  linetypeScale: number;
  /** Millimetres */
  lineweightMm: number;
  /** 0 = opaque, 100 = invisible */
  transparency: number;
  /** Canvas alpha 0–1 */
  alpha: number;
}

export function colorPropertyToStorage(c: ColorProperty): ColorProperty {
  return structuredClone(c);
}

export function appearanceFromCurrent(
  current: CurrentAppearance,
): AppearanceProperties {
  return {
    color: colorPropertyToStorage(current.color),
    linetype: structuredClone(current.linetype),
    linetypeScale: current.linetypeScale,
    lineweight: structuredClone(current.lineweight),
    transparency: structuredClone(current.transparency),
  };
}
