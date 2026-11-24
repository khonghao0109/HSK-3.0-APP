import {
  PROPER_NOUN_POS,
  shouldAutoPublishProperNoun,
  type ProperNounCandidate,
} from './textbook-proper-noun';
import { TEXTBOOK_DATA_SOURCE } from './textbook-seeddata.converter';

const BASE: ProperNounCandidate = {
  publish: true,
  partOfSpeech: 'Danh từ riêng',
  status: 'draft',
  deletedAt: null,
  sourceCodes: [TEXTBOOK_DATA_SOURCE.code],
};

describe('shouldAutoPublishProperNoun (M2.13b FIX-3)', () => {
  it('approves a draft textbook proper noun under --publish', () => {
    expect(PROPER_NOUN_POS).toBe('Danh từ riêng');
    expect(shouldAutoPublishProperNoun(BASE)).toBe(true);
    expect(
      shouldAutoPublishProperNoun({
        ...BASE,
        partOfSpeech: '  Danh từ riêng ',
      }),
    ).toBe(true);
  });

  it.each<[string, Partial<ProperNounCandidate>]>([
    ['another data source', { sourceCodes: ['HSK_DICTIONARY'] }],
    [
      'a dictionary word that also has the textbook source',
      { sourceCodes: [TEXTBOOK_DATA_SOURCE.code, 'HSK_DICTIONARY'] },
    ],
    ['no data source', { sourceCodes: [] }],
    ['another part of speech', { partOfSpeech: 'danh từ' }],
    ['a lower-case proper noun', { partOfSpeech: 'danh từ riêng' }],
    ['no part of speech', { partOfSpeech: null }],
    ['an already published word', { status: 'published' }],
    ['an archived word', { status: 'archived' }],
    ['a soft-deleted word', { deletedAt: new Date('2026-11-24T00:00:00Z') }],
    ['a dry-run', { publish: false }],
  ])('refuses %s', (_label, change) => {
    expect(shouldAutoPublishProperNoun({ ...BASE, ...change })).toBe(false);
  });
});
