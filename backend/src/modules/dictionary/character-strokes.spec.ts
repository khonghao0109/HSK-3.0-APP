import { BadRequestException } from '@nestjs/common';

import {
  CharacterStrokesRow,
  parseStrokesHanzi,
  readStrokeData,
  toCharacterStrokesResponse,
} from './character-strokes';

const source = {
  code: 'MAKEMEAHANZI_GRAPHICS',
  name: 'Make Me a Hanzi',
  version: '1',
  license: 'Arphic',
  attribution: 'skishore',
  referenceUrl: null,
};
const good = {
  strokes: ['M 0 0 Z', 'M 1 1 Z'],
  medians: [
    [
      [0, 0],
      [1, 1],
    ],
    [[2, 2]],
  ],
};
const row = (
  hanzi: string,
  over: Partial<CharacterStrokesRow> = {},
): CharacterStrokesRow => ({
  hanzi,
  strokeCount: 2,
  strokeData: good,
  dataSource: source,
  ...over,
});

function codesOf(raw: unknown): string[] {
  try {
    parseStrokesHanzi(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as {
      code: string;
      errors: { path: string; codes: string[] }[];
    };
    expect(body.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(body.errors[0].path).toBe('$.hanzi');
    return body.errors[0].codes;
  }
  throw new Error('expected 400');
}

describe('parseStrokesHanzi', () => {
  it('dedupes keeping first-seen order', () => {
    expect(parseStrokesHanzi('我们我们你')).toEqual(['我', '们', '你']);
  });
  it('counts a non-BMP character as one', () => {
    expect(parseStrokesHanzi('𠀀我')).toEqual(['𠀀', '我']);
  });
  it('rejects a missing value', () =>
    expect(codesOf(undefined)).toEqual(['isNotEmpty']));
  it('rejects an empty value', () =>
    expect(codesOf('')).toEqual(['isNotEmpty']));
  it('rejects a repeated parameter (array)', () =>
    expect(codesOf(['我', '们'])).toEqual(['isNotEmpty']));
  it('rejects more than 16 raw code points before dedupe', () =>
    expect(codesOf('我'.repeat(17))).toEqual(['maxLength']));
  it('accepts 16 raw code points that dedupe to one', () =>
    expect(parseStrokesHanzi('我'.repeat(16))).toEqual(['我']));
  it('rejects a non-Han character', () =>
    expect(codesOf('我a')).toEqual(['isHanzi']));
  it('rejects more than 8 distinct characters', () =>
    expect(codesOf('一二三四五六七八九')).toEqual(['arrayMaxSize']));
});

describe('readStrokeData', () => {
  it.each([
    ['null', null],
    ['strokes not strings', { strokes: [1], medians: [[[0, 0]]] }],
    ['length mismatch', { strokes: ['M'], medians: [] }],
    ['point not a pair', { strokes: ['M'], medians: [[[0]]] }],
    ['medians not nested', { strokes: ['M'], medians: [[0, 0]] }],
    ['empty', { strokes: [], medians: [] }],
  ])('rejects %s', (_, data) => expect(readStrokeData(data)).toBeNull());
  it('accepts the stored shape', () =>
    expect(readStrokeData(good)).toEqual(good));
});

describe('toCharacterStrokesResponse', () => {
  it('nulls missing and malformed characters and dedupes sources', () => {
    const result = toCharacterStrokesResponse(
      ['我', '们', '你', '他'],
      [row('我'), row('们'), row('他', { strokeData: { strokes: 'x' } })],
    );
    expect(result.characters.map((c) => c.sourceCode)).toEqual([
      'MAKEMEAHANZI_GRAPHICS',
      'MAKEMEAHANZI_GRAPHICS',
      null,
      null,
    ]);
    expect(result.characters[2]).toEqual({
      hanzi: '你',
      strokeCount: null,
      strokes: null,
      medians: null,
      sourceCode: null,
    });
    expect(result.characters[3].strokes).toBeNull();
    expect(result.characters[0]).toEqual({
      hanzi: '我',
      strokeCount: 2,
      ...good,
      sourceCode: 'MAKEMEAHANZI_GRAPHICS',
    });
    expect(result.sources).toEqual([source]);
  });
  it('keeps strokes without a source and returns no sources', () => {
    const result = toCharacterStrokesResponse(
      ['我'],
      [row('我', { dataSource: null })],
    );
    expect(result.characters[0].sourceCode).toBeNull();
    expect(result.characters[0].strokes).toEqual(good.strokes);
    expect(result.sources).toEqual([]);
  });
});
