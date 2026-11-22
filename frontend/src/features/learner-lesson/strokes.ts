// Pure stroke helpers for the Make Me a Hanzi glyph data (1024 box, y flipped).

export type Point = readonly [number, number];

export const GLYPH_TRANSFORM = 'scale(1,-1) translate(0,-900)';

export const STROKE_TOLERANCE = {
  /** Mean resampled distance; mockup accepts below 150. */
  meanDistance: 150,
  /** Start and end of the drawn stroke must each land this close to the median's. */
  endpointDistance: 250,
  /** Anything shorter is a tap or slip, not a stroke. */
  minLength: 60,
} as const;

export type StrokeTolerance = {
  meanDistance: number;
  endpointDistance: number;
  minLength: number;
};

export type StrokeMatch =
  { ok: true } | { ok: false; reason: 'too-short' | 'direction' | 'shape' };

export function toDataPoint(x: number, y: number): Point {
  return [x, 900 - y];
}

export function toBoardPoint([x, y]: Point): Point {
  return [x, 900 - y];
}

export function medianPath(median: readonly Point[]): string {
  return median
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ');
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// Callers only pass in-range indices of non-empty arrays.
const at = (pts: readonly Point[], i: number): Point => pts[i] ?? [0, 0];

export function medianLength(median: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < median.length; i++)
    total += dist(at(median, i - 1), at(median, i));
  return total;
}

export function resample(points: readonly Point[], n = 16): Point[] {
  if (points.length === 0) return [];
  const total = medianLength(points);
  if (points.length === 1 || total === 0)
    return Array.from({ length: n }, () => at(points, 0));
  const out: Point[] = [];
  let seg = 1;
  let walked = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (
      seg < points.length - 1 &&
      walked + dist(at(points, seg - 1), at(points, seg)) < target
    ) {
      walked += dist(at(points, seg - 1), at(points, seg));
      seg++;
    }
    const a = at(points, seg - 1);
    const b = at(points, seg);
    const len = dist(a, b);
    const t = len === 0 ? 0 : Math.min(1, (target - walked) / len);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function fits(a: Point[], b: Point[], tol: StrokeTolerance): boolean {
  const mean = a.reduce((s, p, i) => s + dist(p, at(b, i)), 0) / a.length;
  return (
    mean <= tol.meanDistance &&
    dist(at(a, 0), at(b, 0)) <= tol.endpointDistance &&
    dist(at(a, a.length - 1), at(b, b.length - 1)) <= tol.endpointDistance
  );
}

export function matchStroke(
  drawn: readonly Point[],
  expected: readonly Point[],
  tolerance: StrokeTolerance = STROKE_TOLERANCE,
): StrokeMatch {
  // Dots have short medians; never demand more than half their length.
  const minLength = Math.min(tolerance.minLength, 0.5 * medianLength(expected));
  if (drawn.length < 2 || medianLength(drawn) < minLength)
    return { ok: false, reason: 'too-short' };
  const d = resample(drawn);
  const e = resample(expected);
  if (fits(d, e, tolerance)) return { ok: true };
  if (fits([...d].reverse(), e, tolerance))
    return { ok: false, reason: 'direction' };
  return { ok: false, reason: 'shape' };
}
