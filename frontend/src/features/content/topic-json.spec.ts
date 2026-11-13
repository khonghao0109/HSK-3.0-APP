import { describe, expect, it } from 'vitest';

import { parseTopicJson, TOPIC_JSON_MAX_BYTES } from './topic-json';

describe('parseTopicJson (Q90)', () => {
  it('parses valid JSON and returns the value', () => {
    const result = parseTopicJson('[{"type":"text","value":"Xin chào"}]');
    expect(result).toEqual({
      ok: true,
      value: [{ type: 'text', value: 'Xin chào' }],
    });
  });

  it('reports line and column of a syntax error', () => {
    const result = parseTopicJson('{\n  "a": 1,\n  bad\n}');
    expect(result).toEqual({ ok: false, oversize: false, line: 3, column: 3 });
  });

  it('reports no position when the engine gives none', () => {
    const result = parseTopicJson('');
    expect(result.ok).toBe(false);
    if (!result.ok && !result.oversize) {
      expect(result.line).toBeUndefined();
      expect(result.column).toBeUndefined();
    }
  });

  it('rejects content over 100 000 bytes before parsing', () => {
    const result = parseTopicJson(`[${'a'.repeat(TOPIC_JSON_MAX_BYTES)}]`);
    expect(result).toEqual({ ok: false, oversize: true });
  });

  it('counts UTF-8 bytes, not characters, for the size limit', () => {
    // 50 001 ký tự 'ă' (2 byte) = 100 002 byte > 100 000 dù dưới 100 000 ký tự.
    const result = parseTopicJson('ă'.repeat(50_001));
    expect(result).toEqual({ ok: false, oversize: true });
  });
});
