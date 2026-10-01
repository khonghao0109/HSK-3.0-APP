import { spawnSync } from 'node:child_process';

import {
  CANONICAL_JSON_MAX_DEPTH,
  CanonicalJsonDepthError,
  canonicalJson,
  sha256CanonicalJson,
} from './canonical-json';

describe('canonical JSON', () => {
  it('produces the same JSON and SHA-256 hash regardless of object key order', () => {
    const first = {
      title: 'Lesson',
      nested: { beta: 2, alpha: 1 },
      blocks: [{ value: '你好', type: 'text' }],
    };
    const second = {
      blocks: [{ type: 'text', value: '你好' }],
      nested: { alpha: 1, beta: 2 },
      title: 'Lesson',
    };

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(sha256CanonicalJson(first)).toBe(sha256CanonicalJson(second));
    expect(sha256CanonicalJson(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('preserves array order and rejects unsupported/non-finite values', () => {
    expect(sha256CanonicalJson([1, 2])).not.toBe(sha256CanonicalJson([2, 1]));
    expect(() => canonicalJson({ value: Number.NaN })).toThrow();
    expect(() => canonicalJson({ value: undefined })).toThrow();
    expect(() => canonicalJson({ value: () => undefined })).toThrow();
    expect(() => canonicalJson({ value: Symbol('unsupported') })).toThrow();
    expect(() => canonicalJson({ value: 1n })).toThrow();
    expect(() => canonicalJson(new (class Snapshot {})())).toThrow();
  });

  it('orders ASCII, Vietnamese, Han and surrogate-pair keys by UTF-16 code units', () => {
    expect(
      canonicalJson({
        '😀': 6,
        汉: 5,
        đ: 4,
        á: 3,
        z: 2,
        A: 1,
      }),
    ).toBe('{"A":1,"z":2,"á":3,"đ":4,"汉":5,"😀":6}');
  });

  it('produces identical output in processes with different locale settings', () => {
    const modulePath = JSON.stringify(require.resolve('./canonical-json'));
    const script = `const { canonicalJson } = require(${modulePath}); process.stdout.write(canonicalJson({"😀":6,"汉":5,"đ":4,"á":3,"z":2,"A":1}));`;
    const outputs = ['C', 'vi_VN.UTF-8'].map((locale) =>
      spawnSync(process.execPath, ['-r', 'ts-node/register', '-e', script], {
        encoding: 'utf8',
        env: { ...process.env, LANG: locale, LC_ALL: locale },
      }),
    );

    expect(outputs.map((result) => result.status)).toEqual([0, 0]);
    expect(outputs[0].stdout).toBe(outputs[1].stdout);
    expect(outputs[0].stdout).toBe('{"A":1,"z":2,"á":3,"đ":4,"汉":5,"😀":6}');
  });

  it('serializes ordinary nesting unchanged', () => {
    const value = { a: [{ b: { c: [1, 'two', null, true] } }] };

    expect(canonicalJson(value)).toBe(
      '{"a":[{"b":{"c":[1,"two",null,true]}}]}',
    );
    expect(canonicalJson(value, 5)).toBe(canonicalJson(value));
    expect(sha256CanonicalJson(value)).toBe(sha256CanonicalJson(value, 5));
  });

  it('accepts a payload exactly at the depth bound', () => {
    const atBound = nestObjects(CANONICAL_JSON_MAX_DEPTH);

    expect(canonicalJson(atBound)).toContain('"leaf"');
    expect(() =>
      canonicalJson(nestArrays(CANONICAL_JSON_MAX_DEPTH)),
    ).not.toThrow();
    expect(() => canonicalJson(nestObjects(4), 4)).not.toThrow();
  });

  it('rejects payloads past the bound instead of exhausting the call stack', () => {
    for (const build of [nestObjects, nestArrays]) {
      const tooDeep = build(CANONICAL_JSON_MAX_DEPTH + 1);

      expect(() => canonicalJson(tooDeep)).toThrow(CanonicalJsonDepthError);
      expect(() => sha256CanonicalJson(tooDeep)).toThrow(
        /maximum nesting depth of 16/u,
      );
      expect(() => canonicalJson(build(200_000))).toThrow(
        CanonicalJsonDepthError,
      );
    }

    const error = new CanonicalJsonDepthError(4);
    expect(() => canonicalJson(nestObjects(5), 4)).toThrow(error.message);
  });

  it('requires a positive integer depth bound', () => {
    for (const maxDepth of [0, -1, 1.5, Number.NaN]) {
      expect(() => canonicalJson({ a: 1 }, maxDepth)).toThrow(
        /positive integer/u,
      );
    }
  });
});

function nestObjects(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let level = 0; level < depth; level += 1) value = { nested: value };
  return value;
}

function nestArrays(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let level = 0; level < depth; level += 1) value = [value];
  return value;
}
