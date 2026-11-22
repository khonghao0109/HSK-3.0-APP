import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadWordStrokes,
  readWordStrokes,
  type StrokeCache,
} from './stroke-data';

const char = (hanzi: string) => ({
  hanzi,
  strokeCount: 1,
  strokes: ['M 0 0 L 9 9 Z'],
  medians: [
    [
      [0, 0],
      [9, 9],
    ],
  ],
  sourceCode: 'MMAH',
});
const missing = (hanzi: string) => ({
  hanzi,
  strokeCount: null,
  strokes: null,
  medians: null,
  sourceCode: null,
});
const source = {
  code: 'MMAH',
  name: 'Make Me a Hanzi',
  version: 'v',
  license: 'Arphic Public License',
  attribution: 'Dữ liệu nét chữ: Make Me a Hanzi',
  referenceUrl: 'https://github.com/skishore/makemeahanzi',
};
const body = (characters: unknown[], sources: unknown[] = [source]) => ({
  success: true,
  data: { characters, sources },
});

afterEach(() => vi.unstubAllGlobals());

describe('readWordStrokes (G2d)', () => {
  it('keeps the word order, repeats included', () => {
    const data = readWordStrokes('你你们', body([char('你'), char('们')]));
    expect(data?.characters.map((c) => c.hanzi)).toEqual(['你', '你', '们']);
    expect(data?.sources).toEqual([
      {
        code: 'MMAH',
        attribution: 'Dữ liệu nét chữ: Make Me a Hanzi',
        referenceUrl: 'https://github.com/skishore/makemeahanzi',
      },
    ]);
  });

  it('is null when one character has no strokes', () => {
    expect(
      readWordStrokes('我们', body([char('我'), missing('们')])),
    ).toBeNull();
  });

  it('is null for a malformed median', () => {
    const bad = { ...char('我'), medians: [[[0, 'x']]] };
    expect(readWordStrokes('我', body([bad]))).toBeNull();
  });

  it('drops a non-http link and falls back to the name without attribution', () => {
    const data = readWordStrokes(
      '我',
      body(
        [char('我')],
        [{ ...source, attribution: null, referenceUrl: 'javascript:alert(1)' }],
      ),
    );
    expect(data?.sources).toEqual([
      { code: 'MMAH', attribution: 'Make Me a Hanzi', referenceUrl: null },
    ]);
  });
});

describe('loadWordStrokes (G2d)', () => {
  it('reads a word once per cache, failures included', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => body([char('我')]) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const cache: StrokeCache = new Map();
    expect(await loadWordStrokes(cache, '我')).not.toBeNull();
    expect(await loadWordStrokes(cache, '我')).not.toBeNull();
    expect(await loadWordStrokes(cache, '们')).toBeNull();
    expect(await loadWordStrokes(cache, '们')).toBeNull();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `/api/learner/dictionary/strokes?hanzi=${encodeURIComponent('我')}`,
      `/api/learner/dictionary/strokes?hanzi=${encodeURIComponent('们')}`,
    ]);
  });

  it('never calls the network for a word that is not all Han', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadWordStrokes(new Map(), 'ok')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is null when the read throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await loadWordStrokes(new Map(), '我')).toBeNull();
  });
});
