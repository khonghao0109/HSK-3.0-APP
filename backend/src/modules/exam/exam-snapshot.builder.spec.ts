import { MediaType, QuestionType, Skill } from '@prisma/client';

import { sha256CanonicalJson } from '../../common/utils/canonical-json';
import {
  EXAM_SNAPSHOT_SCHEMA_VERSION,
  buildExamSnapshot,
  type ExamSnapshotSource,
} from './exam-snapshot.builder';

function source(): ExamSnapshotSource {
  return {
    test: {
      id: 7,
      title: 'Đề thi HSK 2 giữa kỳ',
      instruction: 'Làm hết các phần.',
      levelCode: 'HSK2',
      duration: 90,
      passScore: 120,
      maxScore: 200,
      scoringVersion: 'hsk-p0-v1',
      version: 3,
    },
    sections: [
      {
        orderIndex: 1,
        skill: Skill.reading,
        title: 'Đọc hiểu',
        instruction: null,
        groups: [
          {
            orderIndex: 1,
            title: 'Đoạn 1',
            instruction: 'Chọn đáp án đúng.',
            content: { passages: [{ id: 'p1', text: '文本' }] },
            audio: null,
            image: {
              mediaId: 31,
              kind: MediaType.image,
              mimeType: 'image/png',
              durationMs: null,
            },
            questions: [
              {
                placementOrderIndex: 1,
                question: {
                  id: 101,
                  version: 2,
                  type: QuestionType.mcq,
                  skill: Skill.reading,
                  content: 'Câu hỏi trắc nghiệm',
                  answers: { options: [{ id: 'a', text: 'A' }] },
                  correctAnswer: { optionId: 'a' },
                  explanation: 'Vì A đúng.',
                  audio: null,
                  image: null,
                },
              },
            ],
          },
          {
            orderIndex: 2,
            title: 'Đoạn 2',
            instruction: null,
            content: null,
            audio: {
              mediaId: 32,
              kind: MediaType.audio,
              mimeType: 'audio/mpeg',
              durationMs: 12_000,
            },
            image: null,
            questions: [
              {
                placementOrderIndex: 2,
                question: {
                  id: 102,
                  version: 1,
                  type: QuestionType.arrange_sentence,
                  skill: Skill.reading,
                  content: 'Sắp xếp câu',
                  // The authoring form already shuffled these tokens; the
                  // snapshot must not reorder them.
                  answers: {
                    tokens: [
                      { id: 't3', text: '三' },
                      { id: 't1', text: '一' },
                      { id: 't2', text: '二' },
                    ],
                  },
                  correctAnswer: { tokenIds: ['t1', 't2', 't3'] },
                  explanation: null,
                  audio: null,
                  image: null,
                },
              },
            ],
          },
        ],
      },
      {
        orderIndex: 2,
        skill: Skill.listening,
        title: 'Nghe hiểu',
        instruction: 'Nghe rồi chọn.',
        groups: [
          {
            orderIndex: 1,
            title: null,
            instruction: null,
            content: null,
            audio: null,
            image: null,
            questions: [
              {
                placementOrderIndex: 3,
                question: {
                  id: 103,
                  version: 1,
                  type: QuestionType.true_false,
                  skill: Skill.listening,
                  content: 'Đúng hay sai?',
                  answers: {},
                  correctAnswer: true,
                  explanation: 'Đúng theo đoạn nghe.',
                  audio: null,
                  image: null,
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

const zeroRandom = (): number => 0;
const identityRandom = (maxExclusive: number): number => maxExclusive - 1;

function build(
  value: ExamSnapshotSource = source(),
  randomInt: (maxExclusive: number) => number = zeroRandom,
) {
  return buildExamSnapshot(value, randomInt);
}

describe('buildExamSnapshot (TL-113)', () => {
  it('freezes the whole tree with section/group/question keys', () => {
    const { payload } = build();

    expect(payload.schemaVersion).toBe(EXAM_SNAPSHOT_SCHEMA_VERSION);
    expect(payload.test).toEqual({
      id: 7,
      title: 'Đề thi HSK 2 giữa kỳ',
      instruction: 'Làm hết các phần.',
      levelCode: 'HSK2',
      durationMinutes: 90,
      passScore: 120,
      maxScore: 200,
      scoringVersion: 'hsk-p0-v1',
    });

    expect(payload.sections.map((section) => section.key)).toEqual([
      's1',
      's2',
    ]);
    expect(payload.sections[0]?.maxScore).toBe(100);
    expect(payload.sections[1]?.maxScore).toBe(100);
    expect(payload.sections[0]?.groups.map((group) => group.key)).toEqual([
      's1-g1',
      's1-g2',
    ]);
    expect(payload.sections[0]?.groups[1]?.questions.map((q) => q.key)).toEqual(
      ['q2'],
    );
    expect(payload.sections[1]?.groups[0]?.questions[0]?.key).toBe('q3');
  });

  it('keeps internal scoring fields inside the snapshot', () => {
    const { payload } = build();
    const question = payload.sections[0]?.groups[0]?.questions[0];

    expect(question).toMatchObject({
      orderIndex: 1,
      questionId: 101,
      questionVersion: 2,
      type: QuestionType.mcq,
      skill: Skill.reading,
      content: 'Câu hỏi trắc nghiệm',
      answers: { options: [{ id: 'a', text: 'A' }] },
      correctAnswer: { optionId: 'a' },
      explanation: 'Vì A đúng.',
    });
  });

  it('projects media to the documented snapshot shape', () => {
    const { payload } = build();

    expect(payload.sections[0]?.groups[0]?.image).toEqual({
      mediaId: 31,
      kind: MediaType.image,
      mimeType: 'image/png',
      durationMs: null,
    });
    expect(payload.sections[0]?.groups[1]?.audio).toEqual({
      mediaId: 32,
      kind: MediaType.audio,
      mimeType: 'audio/mpeg',
      durationMs: 12_000,
    });
    expect(payload.sections[0]?.groups[1]?.image).toBeNull();
  });

  it('shuffles and renumbers the arrange_sentence tokens per attempt (TL-133)', () => {
    const { payload } = build();
    const question = payload.sections[0]?.groups[1]?.questions[0];

    // The fixture stores [三,一,二] as the answer order; zeroRandom would put
    // the tokens back into that order, so the mask shuffles again and then
    // forces a swap: [二,一,三] with ids assigned by display position.
    expect(question?.answers).toEqual({
      tokens: [
        { id: 't1', text: '二' },
        { id: 't2', text: '一' },
        { id: 't3', text: '三' },
      ],
    });
    expect(question?.correctAnswer).toEqual({ tokenIds: ['t2', 't1', 't3'] });

    // The masked answer map still rebuilds the authored sentence.
    const tokens = (
      question?.answers as { tokens: Array<{ id: string; text: string }> }
    ).tokens;
    const byId = new Map(tokens.map((token) => [token.id, token.text]));
    const rebuilt = (
      question?.correctAnswer as { tokenIds: string[] }
    ).tokenIds.map((id) => byId.get(id));
    expect(rebuilt).toEqual(['一', '二', '三']);
  });

  it('leaves mcq, true_false and fill_blank answers untouched', () => {
    const withFillBlank = source();
    const listeningGroup = withFillBlank.sections[1]?.groups[0];
    if (!listeningGroup) throw new Error('fixture missing listening group');
    listeningGroup.questions.push({
      placementOrderIndex: 4,
      question: {
        id: 104,
        version: 1,
        type: QuestionType.fill_blank,
        skill: Skill.listening,
        content: 'Điền từ',
        answers: { acceptedTexts: ['你好'] },
        correctAnswer: { acceptedTexts: ['你好'], caseSensitive: false },
        explanation: null,
        audio: null,
        image: null,
      },
    });

    const { payload } = build(withFillBlank);
    const untouched = [
      payload.sections[0]?.groups[0]?.questions[0],
      payload.sections[1]?.groups[0]?.questions[0],
      payload.sections[1]?.groups[0]?.questions[1],
    ];

    expect(untouched[0]?.answers).toEqual({
      options: [{ id: 'a', text: 'A' }],
    });
    expect(untouched[0]?.correctAnswer).toEqual({ optionId: 'a' });
    expect(untouched[1]?.answers).toEqual({});
    expect(untouched[1]?.correctAnswer).toBe(true);
    expect(untouched[2]?.answers).toEqual({ acceptedTexts: ['你好'] });
    expect(untouched[2]?.correctAnswer).toEqual({
      acceptedTexts: ['你好'],
      caseSensitive: false,
    });
  });

  it('hashes the canonical JSON payload and reports the test version', () => {
    const first = build();
    const second = build();

    expect(first.contentHash).toBe(sha256CanonicalJson(first.payload));
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic only when the RNG is injected; production hashes differ per
    // attempt because the arrange tokens are shuffled per snapshot (TL-133).
    expect(second.contentHash).toBe(first.contentHash);
    expect(first.testVersion).toBe(3);
    expect(first.snapshotVersion).toBe(EXAM_SNAPSHOT_SCHEMA_VERSION);
  });

  it('produces a different contentHash for a different arrange permutation', () => {
    const masked = build(source(), zeroRandom);
    const otherPermutation = build(source(), identityRandom);

    expect(otherPermutation.contentHash).not.toBe(masked.contentHash);
    expect(otherPermutation.contentHash).toBe(
      sha256CanonicalJson(otherPermutation.payload),
    );
  });

  it('changes the hash when frozen content changes', () => {
    const changed = source();
    const group = changed.sections[0]?.groups[0];
    if (!group) throw new Error('fixture missing group');
    group.questions = [];
    group.instruction = 'Chọn đáp án đúng nhất.';

    expect(build(changed).contentHash).not.toBe(build().contentHash);
  });

  it('uses 100 × sectionCount for maxScore and never trusts a caller value', () => {
    const wrong = source();
    wrong.test.maxScore = 999;
    expect(build(wrong).payload.test.maxScore).toBe(200);

    const single = source();
    single.sections = single.sections.slice(0, 1);
    expect(build(single).payload.test.maxScore).toBe(100);
  });
});
