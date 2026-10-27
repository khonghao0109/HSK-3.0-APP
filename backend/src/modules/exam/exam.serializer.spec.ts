import {
  ExamAttemptStatus,
  MediaType,
  QuestionType,
  Skill,
} from '@prisma/client';

import {
  buildExamSnapshot,
  type ExamSnapshotPayload,
  type ExamSnapshotSource,
} from './exam-snapshot.builder';
import {
  toExamAnswerSaveView,
  toExamAnswerView,
  toExamAttemptView,
  toExamTestIntro,
} from './exam.serializer';

/**
 * R11 (TL-114): a learner-facing serializer may only copy an allow-list of
 * fields. Every forbidden key below is present somewhere in the source tree —
 * inside `correctAnswer`, `explanation`, the arrangement tokens or a poisoned
 * answer payload — so a "copy then delete" implementation would leak it.
 */
const FORBIDDEN_KEYS = [
  'correctAnswer',
  'explanation',
  'acceptedTexts',
  'caseSensitive',
  'tokenIds',
  'optionId',
  'isCorrect',
  'contentHash',
  'questionId',
  'questionVersion',
];

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.push(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

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
                  // Poisoned: the live option list must not carry isCorrect.
                  answers: {
                    options: [
                      { id: 'a', text: 'A', isCorrect: true },
                      { id: 'b', text: 'B', isCorrect: false },
                    ],
                  },
                  correctAnswer: { optionId: 'a' },
                  explanation: 'Vì A đúng.',
                  audio: null,
                  image: null,
                },
              },
              {
                placementOrderIndex: 2,
                question: {
                  id: 102,
                  version: 1,
                  type: QuestionType.arrange_sentence,
                  skill: Skill.reading,
                  content: 'Sắp xếp câu',
                  answers: {
                    tokens: [
                      { id: 't3', text: '三', tokenIds: ['leak'] },
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
            audio: {
              mediaId: 32,
              kind: MediaType.audio,
              mimeType: 'audio/mpeg',
              durationMs: 12_000,
            },
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
                  audio: {
                    mediaId: 32,
                    kind: MediaType.audio,
                    mimeType: 'audio/mpeg',
                    durationMs: 12_000,
                  },
                  image: null,
                },
              },
              {
                placementOrderIndex: 4,
                question: {
                  id: 104,
                  version: 1,
                  type: QuestionType.fill_blank,
                  skill: Skill.listening,
                  content: 'Điền từ còn thiếu',
                  // Poisoned: answer metadata with grading rules.
                  answers: {
                    acceptedTexts: ['你好'],
                    caseSensitive: true,
                    tokenIds: ['x'],
                  },
                  correctAnswer: {
                    acceptedTexts: ['你好'],
                    caseSensitive: true,
                  },
                  explanation: null,
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

const NOW = new Date('2026-10-27T09:30:00.000Z');

function attemptView() {
  const { payload } = buildExamSnapshot(source());
  return toExamAttemptView({
    attempt: {
      id: 55,
      testId: 7,
      status: ExamAttemptStatus.in_progress,
      startedAt: new Date('2026-10-27T09:00:00.000Z'),
      expiresAt: new Date('2026-10-27T10:30:00.000Z'),
      maxScore: 200,
    },
    snapshot: { payload },
    now: NOW,
    answers: [],
  });
}

describe('exam serializers (R11 / TL-114)', () => {
  describe('toExamAttemptView', () => {
    it('exposes exactly the documented allow-list', () => {
      const view = attemptView();

      expect(Object.keys(view).sort()).toEqual([
        'answers',
        'expiresAt',
        'id',
        'maxScore',
        'questionCount',
        'remainingSeconds',
        'sections',
        'serverNow',
        'startedAt',
        'status',
        'test',
        'testId',
      ]);
      expect(Object.keys(view.test).sort()).toEqual([
        'durationMinutes',
        'instruction',
        'levelCode',
        'passScore',
        'title',
      ]);
      expect(view).toMatchObject({
        id: 55,
        testId: 7,
        status: ExamAttemptStatus.in_progress,
        serverNow: NOW,
        remainingSeconds: 3_600,
        maxScore: 200,
        questionCount: 4,
        answers: [],
      });
      expect(
        view.sections.map((section) => Object.keys(section).sort()),
      ).toEqual([
        ['groups', 'instruction', 'key', 'orderIndex', 'skill', 'title'],
        ['groups', 'instruction', 'key', 'orderIndex', 'skill', 'title'],
      ]);
      expect(view.sections[0]?.groups[0]?.questions[0]).toMatchObject({
        key: 'q1',
        orderIndex: 1,
        type: QuestionType.mcq,
        skill: Skill.reading,
        content: 'Câu hỏi trắc nghiệm',
      });
    });

    it('projects only the renderable answer fields per question type', () => {
      const view = attemptView();
      const questions = view.sections.flatMap((section) =>
        section.groups.flatMap((group) => group.questions),
      );

      expect(questions[0]?.answers).toEqual({
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
      });
      // shortcut: tokens keep the stored order and drop every extra key.
      expect(questions[1]?.answers).toEqual({
        tokens: [
          { id: 't3', text: '三' },
          { id: 't1', text: '一' },
          { id: 't2', text: '二' },
        ],
      });
      expect(questions[2]?.answers).toEqual({});
      expect(questions[3]?.answers).toEqual({});
    });

    it('never exposes a forbidden key anywhere in the body', () => {
      const keys = collectKeys(attemptView());

      for (const forbidden of FORBIDDEN_KEYS) {
        expect(keys.filter((key) => key === forbidden)).toEqual([]);
      }
    });

    it('never exposes the snapshot hash or question identity of the payload', () => {
      const view = attemptView();
      const contentHash = buildExamSnapshot(source()).contentHash;
      const keys = collectKeys(view);

      expect(keys).not.toContain('payload');
      expect(keys).not.toContain('snapshotVersion');
      expect(keys).not.toContain('testVersion');
      expect(JSON.stringify(view)).not.toContain(contentHash);
    });

    it('clamps remainingSeconds at zero after expiry', () => {
      const { payload } = buildExamSnapshot(source());
      const view = toExamAttemptView({
        attempt: {
          id: 55,
          testId: 7,
          status: ExamAttemptStatus.timed_out,
          startedAt: new Date('2026-10-27T09:00:00.000Z'),
          expiresAt: new Date('2026-10-27T09:10:00.000Z'),
          maxScore: 200,
        },
        snapshot: { payload },
        now: NOW,
        answers: [],
      });

      expect(view.remainingSeconds).toBe(0);
      expect(view.status).toBe(ExamAttemptStatus.timed_out);
    });

    it('maps stored answers through the same allow-list', () => {
      const { payload } = buildExamSnapshot(source());
      const view = toExamAttemptView({
        attempt: {
          id: 55,
          testId: 7,
          status: ExamAttemptStatus.in_progress,
          startedAt: new Date('2026-10-27T09:00:00.000Z'),
          expiresAt: new Date('2026-10-27T10:30:00.000Z'),
          maxScore: 200,
        },
        snapshot: { payload },
        now: NOW,
        answers: [
          {
            snapshotQuestionKey: 'q1',
            answer: { choice: 'a' },
            isFlagged: true,
            version: 2,
            answeredAt: new Date('2026-10-27T09:10:00.000Z'),
            lastSavedAt: new Date('2026-10-27T09:20:00.000Z'),
          },
        ],
      });

      expect(view.answers).toEqual([
        {
          questionKey: 'q1',
          answer: { choice: 'a' },
          isFlagged: true,
          version: 2,
          answeredAt: new Date('2026-10-27T09:10:00.000Z'),
          lastSavedAt: new Date('2026-10-27T09:20:00.000Z'),
        },
      ]);
      expect(collectKeys(view)).not.toContain('detailJson');
    });

    it('keeps media in the documented projection and nothing else', () => {
      const view = attemptView();

      expect(view.sections[1]?.groups[0]?.audio).toEqual({
        mediaId: 32,
        kind: MediaType.audio,
        mimeType: 'audio/mpeg',
        durationMs: 12_000,
      });
      expect(view.sections[0]?.groups[0]?.image).toEqual({
        mediaId: 31,
        kind: MediaType.image,
        mimeType: 'image/png',
        durationMs: null,
      });
    });
  });

  describe('toExamTestIntro', () => {
    it('exposes exactly the documented allow-list', () => {
      const intro = toExamTestIntro({
        test: {
          id: 7,
          title: 'Đề thi HSK 2 giữa kỳ',
          instruction: 'Làm hết các phần.',
          levelCode: 'HSK2',
          duration: 90,
          passScore: 120,
          maxScore: 200,
          questionCount: 4,
          sections: [
            {
              orderIndex: 1,
              skill: Skill.reading,
              title: 'Đọc hiểu',
              questionCount: 2,
            },
            {
              orderIndex: 2,
              skill: Skill.listening,
              title: 'Nghe hiểu',
              questionCount: 2,
            },
          ],
        },
        activeAttempt: null,
      });

      expect(Object.keys(intro).sort()).toEqual([
        'activeAttempt',
        'durationMinutes',
        'id',
        'instruction',
        'levelCode',
        'maxScore',
        'passScore',
        'questionCount',
        'sectionCount',
        'sections',
        'title',
      ]);
      expect(intro).toMatchObject({
        id: 7,
        durationMinutes: 90,
        questionCount: 4,
        sectionCount: 2,
        maxScore: 200,
        passScore: 120,
        activeAttempt: null,
      });
      expect(intro.sections).toEqual([
        {
          orderIndex: 1,
          skill: Skill.reading,
          title: 'Đọc hiểu',
          questionCount: 2,
          maxScore: 100,
        },
        {
          orderIndex: 2,
          skill: Skill.listening,
          title: 'Nghe hiểu',
          questionCount: 2,
          maxScore: 100,
        },
      ]);
    });

    it('summarizes the caller active attempt', () => {
      const intro = toExamTestIntro({
        test: {
          id: 7,
          title: 'Đề thi HSK 2 giữa kỳ',
          instruction: null,
          levelCode: 'HSK2',
          duration: 90,
          passScore: null,
          maxScore: 100,
          questionCount: 1,
          sections: [
            {
              orderIndex: 1,
              skill: Skill.reading,
              title: 'Đọc hiểu',
              questionCount: 1,
            },
          ],
        },
        activeAttempt: {
          id: 55,
          startedAt: new Date('2026-10-27T09:00:00.000Z'),
          expiresAt: new Date('2026-10-27T10:30:00.000Z'),
          answeredCount: 0,
        },
      });

      expect(intro.activeAttempt).toEqual({
        id: 55,
        startedAt: new Date('2026-10-27T09:00:00.000Z'),
        expiresAt: new Date('2026-10-27T10:30:00.000Z'),
        answeredCount: 0,
        questionCount: 1,
      });
      expect(Object.keys(intro.activeAttempt ?? {}).sort()).toEqual([
        'answeredCount',
        'expiresAt',
        'id',
        'questionCount',
        'startedAt',
      ]);
    });
  });
});

describe('exam answer serializers (TL-121 / TL-127)', () => {
  const stored = {
    snapshotQuestionKey: 'q2',
    answer: { value: true },
    isFlagged: false,
    version: 3,
    answeredAt: new Date('2026-10-27T09:10:00.000Z'),
    lastSavedAt: new Date('2026-10-27T09:20:00.000Z'),
  };

  it('exposes exactly the documented answer allow-list', () => {
    const view = toExamAnswerView(stored);

    expect(Object.keys(view).sort()).toEqual([
      'answer',
      'answeredAt',
      'isFlagged',
      'lastSavedAt',
      'questionKey',
      'version',
    ]);
    expect(view).toEqual({
      questionKey: 'q2',
      answer: { value: true },
      isFlagged: false,
      version: 3,
      answeredAt: new Date('2026-10-27T09:10:00.000Z'),
      lastSavedAt: new Date('2026-10-27T09:20:00.000Z'),
    });
  });

  it('adds serverNow and a non-negative remainingSeconds to the save view', () => {
    const view = toExamAnswerSaveView({
      answer: stored,
      now: new Date('2026-10-27T10:31:00.000Z'),
      expiresAt: new Date('2026-10-27T10:30:00.000Z'),
    });

    expect(Object.keys(view).sort()).toEqual([
      'answer',
      'answeredAt',
      'isFlagged',
      'lastSavedAt',
      'questionKey',
      'remainingSeconds',
      'serverNow',
      'version',
    ]);
    expect(view.remainingSeconds).toBe(0);
    expect(view.serverNow).toEqual(new Date('2026-10-27T10:31:00.000Z'));
  });
});

/**
 * The payload is the only place the frozen answers may live; this guards the
 * fixture itself so a later refactor cannot "pass" by removing the secrets.
 */
export function assertPayloadStillHoldsSecrets(
  payload: ExamSnapshotPayload,
): void {
  const keys = collectKeys(payload);
  for (const internal of ['correctAnswer', 'explanation']) {
    expect(keys).toContain(internal);
  }
}
