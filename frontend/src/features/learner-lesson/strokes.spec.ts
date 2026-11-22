import { describe, expect, it } from 'vitest';

import {
  type Point,
  STROKE_TOLERANCE,
  matchStroke,
  medianLength,
  medianPath,
  resample,
  toBoardPoint,
  toDataPoint,
} from './strokes';

const horizontal: Point[] = [
  [100, 500],
  [500, 500],
  [900, 500],
];
const vertical: Point[] = [
  [500, 800],
  [500, 100],
];
const shift = (pts: Point[], dy: number): Point[] =>
  pts.map(([x, y]) => [x, y + dy]);

describe('geometry', () => {
  it('builds path and length', () => {
    expect(
      medianPath([
        [0, 0],
        [3, 4],
        [3, 10],
      ]),
    ).toBe('M 0 0 L 3 4 L 3 10');
    expect(
      medianLength([
        [0, 0],
        [3, 4],
        [3, 10],
      ]),
    ).toBe(11);
  });

  it('resamples evenly by arc length', () => {
    expect(
      resample(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        5,
      ),
    ).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 5],
      [10, 10],
    ]);
    expect(resample(horizontal)).toHaveLength(16);
  });

  it('board and data points are inverses', () => {
    expect(toDataPoint(100, 200)).toEqual([100, 700]);
    expect(toBoardPoint(toDataPoint(123, 456))).toEqual([123, 456]);
    expect(toDataPoint(...toBoardPoint([10, -50]))).toEqual([10, -50]);
  });
});

describe('matchStroke', () => {
  it('accepts a noisy stroke along the median', () => {
    const drawn: Point[] = [
      [110, 520],
      [300, 480],
      [500, 515],
      [700, 490],
      [890, 510],
    ];
    expect(matchStroke(drawn, horizontal)).toEqual({ ok: true });
  });

  it('reports reversed strokes as direction', () => {
    expect(matchStroke([...horizontal].reverse(), horizontal)).toEqual({
      ok: false,
      reason: 'direction',
    });
  });

  it('reports another stroke median as shape', () => {
    expect(matchStroke(vertical, horizontal)).toEqual({
      ok: false,
      reason: 'shape',
    });
  });

  it('rejects taps and tiny strokes', () => {
    expect(matchStroke([[500, 500]], horizontal)).toEqual({
      ok: false,
      reason: 'too-short',
    });
    expect(
      matchStroke(
        [
          [500, 500],
          [530, 500],
        ],
        horizontal,
      ),
    ).toEqual({ ok: false, reason: 'too-short' });
  });

  it('accepts a short drawn dot against a short median', () => {
    const dot: Point[] = [
      [400, 600],
      [440, 560],
    ];
    expect(
      matchStroke(
        [
          [405, 598],
          [438, 562],
        ],
        dot,
      ),
    ).toEqual({ ok: true });
  });

  it('respects the mean distance boundary', () => {
    const m = STROKE_TOLERANCE.meanDistance;
    expect(matchStroke(shift(horizontal, m - 1), horizontal)).toEqual({
      ok: true,
    });
    expect(matchStroke(shift(horizontal, m + 1), horizontal)).toEqual({
      ok: false,
      reason: 'shape',
    });
  });
});
