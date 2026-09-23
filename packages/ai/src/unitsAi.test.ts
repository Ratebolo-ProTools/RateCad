import { describe, expect, it } from 'vitest';
import {
  parseAiDisplayUnitChange,
  parseAiLength,
  parseAiWorldUnitConversion,
} from '../src/index.js';

describe('AI unit parsing helpers', () => {
  it('parses natural-language lengths into world feet', () => {
    expect(parseAiLength('Draw a line 10 feet long.', 'ft', 'ft-in')?.worldValue).toBeCloseTo(
      10,
      10,
    );
    expect(parseAiLength('Create a wall 3.5 m long', 'ft', 'm')?.worldValue).toBeCloseTo(
      3.5 / 0.3048,
      8,
    );
    expect(parseAiLength(`Make it 3'-4"`, 'ft', 'ft-in')?.worldValue).toBeCloseTo(
      3 + 4 / 12,
      10,
    );
  });

  it('detects display unit changes vs geometry conversion', () => {
    expect(parseAiDisplayUnitChange('Change the drawing units to meters.')).toBe('m');
    expect(parseAiDisplayUnitChange('Show dimensions in feet and inches.')).toBe('ft-in');
    expect(parseAiWorldUnitConversion('Convert the drawing dimensions to millimeters.')).toBe(
      'mm',
    );
  });
});
