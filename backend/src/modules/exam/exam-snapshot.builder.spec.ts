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

describe('buildExamSnapshot (TL-113)', () => {
  it('freezes the whole tree with section/group/question keys', () => {
    const { payload } = buildExamSnapshot(source());

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
    const { payload } = buildExamSnapshot(source());
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
    const { payload } = buildExamSnapshot(source());

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

  it('keeps the stored arrange_sentence token order (shortcut)', () => {
    const { payload } = buildExamSnapshot(source());
    const tokens = payload.sections[0]?.groups[1]?.questions[0]?.answers;

    expect(tokens).toEqual({
      tokens: [
        { id: 't3', text: '三' },
        { id: 't1', text: '一' },
        { id: 't2', text: '二' },
      ],
    });
  });

  it('hashes the canonical JSON payload and reports the test version', () => {
    const first = buildExamSnapshot(source());
    const second = buildExamSnapshot(source());

    expect(first.contentHash).toBe(sha256CanonicalJson(first.payload));
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.contentHash).toBe(first.contentHash);
    expect(first.testVersion).toBe(3);
    expect(first.snapshotVersion).toBe(EXAM_SNAPSHOT_SCHEMA_VERSION);
  });

  it('changes the hash when frozen content changes', () => {
    const changed = source();
    const group = changed.sections[0]?.groups[0];
    if (!group) throw new Error('fixture missing group');
    group.questions = [];
    group.instruction = 'Chọn đáp án đúng nhất.';

    expect(buildExamSnapshot(changed).contentHash).not.toBe(
      buildExamSnapshot(source()).contentHash,
    );
  });

  it('uses 100 × sectionCount for maxScore and never trusts a caller value', () => {
    const wrong = source();
    wrong.test.maxScore = 999;
    expect(buildExamSnapshot(wrong).payload.test.maxScore).toBe(200);

    const single = source();
    single.sections = single.sections.slice(0, 1);
    expect(buildExamSnapshot(single).payload.test.maxScore).toBe(100);
  });
});
