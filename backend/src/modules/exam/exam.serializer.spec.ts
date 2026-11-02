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
import type { ExamResultDetail } from './exam-result.reader';
import {
  toExamAnswerSaveView,
  toExamAnswerView,
  toExamAttemptView,
  toExamResultView,
  toExamReviewView,
  toExamTestIntro,
  type ExamStoredAnswer,
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
// TL-133: build with an injected RNG so the masked arrange tokens are a worked
// example instead of a random permutation.
const FIXED_RANDOM_INT = (): number => 0;

function attemptView() {
  const { payload } = buildExamSnapshot(source(), FIXED_RANDOM_INT);
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
      // TL-133: the snapshot already shuffled and renumbered the tokens, so
      // only the display payload (with extra keys dropped) is projected.
      expect(questions[1]?.answers).toEqual({
        tokens: [
          { id: 't1', text: '二' },
          { id: 't2', text: '一' },
          { id: 't3', text: '三' },
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
      const contentHash = buildExamSnapshot(
        source(),
        FIXED_RANDOM_INT,
      ).contentHash;
      const keys = collectKeys(view);

      expect(keys).not.toContain('payload');
      expect(keys).not.toContain('snapshotVersion');
      expect(keys).not.toContain('testVersion');
      expect(JSON.stringify(view)).not.toContain(contentHash);
    });

    it('clamps remainingSeconds at zero after expiry', () => {
      const { payload } = buildExamSnapshot(source(), FIXED_RANDOM_INT);
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

    it('reports zero remainingSeconds for a submitted attempt before its deadline (TL-152)', () => {
      const { payload } = buildExamSnapshot(source(), FIXED_RANDOM_INT);
      const view = toExamAttemptView({
        attempt: {
          id: 56,
          testId: 7,
          status: ExamAttemptStatus.submitted,
          startedAt: new Date('2026-10-27T09:00:00.000Z'),
          expiresAt: new Date('2026-10-27T10:30:00.000Z'),
          maxScore: 200,
        },
        snapshot: { payload },
        now: NOW,
        answers: [],
      });

      expect(view.remainingSeconds).toBe(0);
      expect(view.status).toBe(ExamAttemptStatus.submitted);
    });

    it('maps stored answers through the same allow-list', () => {
      const { payload } = buildExamSnapshot(source(), FIXED_RANDOM_INT);
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

describe('exam result and review serializers (A3 / TL-165 / TL-166)', () => {
  const GRADED_AT = new Date('2026-11-02T09:45:00.000Z');

  function detail(): ExamResultDetail {
    return {
      schemaVersion: 1,
      attemptScoringVersion: 'hsk-p0-v1',
      snapshotContentHash: 'a'.repeat(64),
      counts: {
        answeredCount: 3,
        correctCount: 2,
        incorrectCount: 1,
        unansweredCount: 1,
      },
      sections: [
        {
          key: 's1',
          skill: Skill.reading,
          questionCount: 2,
          correctCount: 1,
          score: 50,
          maxScore: 100,
        },
        {
          key: 's2',
          skill: Skill.listening,
          questionCount: 2,
          correctCount: 1,
          score: 50,
          maxScore: 100,
        },
      ],
      weakAreas: [
        {
          slug: 'grammar',
          name: 'Ngữ pháp',
          answered: 2,
          correct: 0,
          accuracy: 0,
          level: 'weak',
        },
      ],
      questions: [
        { key: 'q1', isCorrect: true },
        { key: 'q2', isCorrect: false },
        { key: 'q3', isCorrect: true },
        { key: 'q4', isCorrect: false },
      ],
    };
  }

  function terminalAttempt() {
    return {
      id: 55,
      testId: 7,
      status: ExamAttemptStatus.submitted,
      startedAt: new Date('2026-10-27T09:00:00.000Z'),
      submittedAt: new Date('2026-10-27T10:00:00.000Z'),
    };
  }

  function resultView() {
    const { payload } = buildExamSnapshot(source(), FIXED_RANDOM_INT);
    return toExamResultView({
      attempt: terminalAttempt(),
      snapshot: { payload },
      result: {
        score: 150,
        maxScore: 200,
        passed: true,
        scoringVersion: 'exam-score-v1',
        publishedAt: GRADED_AT,
        detail: detail(),
        skillScores: [
          { skill: Skill.listening, score: 50, total: 100 },
          { skill: Skill.reading, score: 100, total: 100 },
        ],
      },
    });
  }

  const learnerAnswers: ExamStoredAnswer[] = [
    {
      snapshotQuestionKey: 'q1',
      answer: { choice: 'a' },
      isFlagged: false,
      version: 1,
      answeredAt: new Date('2026-10-27T09:10:00.000Z'),
      lastSavedAt: new Date('2026-10-27T09:10:00.000Z'),
    },
    {
      // q4 was cleared: a stored JSON null means "not answered" on review.
      snapshotQuestionKey: 'q4',
      answer: null,
      isFlagged: false,
      version: 2,
      answeredAt: null,
      lastSavedAt: new Date('2026-10-27T09:12:00.000Z'),
    },
  ];

  function reviewView() {
    const { payload } = buildExamSnapshot(source(), FIXED_RANDOM_INT);
    return toExamReviewView({
      attempt: terminalAttempt(),
      snapshot: { payload },
      result: { detail: detail() },
      answers: learnerAnswers,
    });
  }

  it('builds the result view from the stored row with the documented allow-list', () => {
    const view = resultView();

    expect(Object.keys(view).sort()).toEqual([
      'attemptId',
      'counts',
      'gradedAt',
      'maxScore',
      'passScore',
      'passed',
      'score',
      'scoringVersion',
      'sections',
      'skills',
      'startedAt',
      'status',
      'submittedAt',
      'testId',
      'testTitle',
      'weakAreas',
    ]);
    expect(view).toMatchObject({
      attemptId: 55,
      testId: 7,
      status: ExamAttemptStatus.submitted,
      // Title and pass line come from the frozen snapshot, not the live row.
      testTitle: 'Đề thi HSK 2 giữa kỳ',
      startedAt: new Date('2026-10-27T09:00:00.000Z'),
      submittedAt: new Date('2026-10-27T10:00:00.000Z'),
      score: 150,
      maxScore: 200,
      passScore: 120,
      passed: true,
      scoringVersion: 'exam-score-v1',
      gradedAt: GRADED_AT,
      counts: {
        answeredCount: 3,
        correctCount: 2,
        incorrectCount: 1,
        unansweredCount: 1,
      },
    });
    expect(view.sections.map((section) => Object.keys(section).sort())).toEqual(
      [
        [
          'correctCount',
          'key',
          'maxScore',
          'questionCount',
          'score',
          'skill',
          'title',
        ],
        [
          'correctCount',
          'key',
          'maxScore',
          'questionCount',
          'score',
          'skill',
          'title',
        ],
      ],
    );
    expect(view.sections).toEqual([
      {
        key: 's1',
        title: 'Đọc hiểu',
        skill: Skill.reading,
        questionCount: 2,
        correctCount: 1,
        score: 50,
        maxScore: 100,
      },
      {
        key: 's2',
        title: 'Nghe hiểu',
        skill: Skill.listening,
        questionCount: 2,
        correctCount: 1,
        score: 50,
        maxScore: 100,
      },
    ]);
    // Q153: a skill total is the persisted ResultSkillScore (score/total).
    expect(view.skills).toEqual([
      { skill: Skill.listening, score: 50, maxScore: 100 },
      { skill: Skill.reading, score: 100, maxScore: 100 },
    ]);
    expect(view.weakAreas).toEqual([
      {
        slug: 'grammar',
        name: 'Ngữ pháp',
        answered: 2,
        correct: 0,
        accuracy: 0,
        level: 'weak',
      },
    ]);
  });

  it('never exposes a forbidden key in the result body', () => {
    const keys = collectKeys(resultView());
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.filter((key) => key === forbidden)).toEqual([]);
    }
  });

  it('falls back to the frozen maxScore when the Result row has none', () => {
    const { payload } = buildExamSnapshot(source(), FIXED_RANDOM_INT);
    const view = toExamResultView({
      attempt: terminalAttempt(),
      snapshot: { payload },
      result: {
        score: 0,
        maxScore: null,
        passed: null,
        scoringVersion: 'exam-score-v1',
        publishedAt: GRADED_AT,
        detail: detail(),
        skillScores: [],
      },
    });
    expect(view.maxScore).toBe(200);
    expect(view.passed).toBeNull();
  });

  it('fails closed when the stored breakdown names an unknown section', () => {
    const broken = detail();
    broken.sections = [
      {
        key: 's9',
        skill: Skill.reading,
        questionCount: 1,
        correctCount: 1,
        score: 100,
        maxScore: 100,
      },
    ];
    const { payload } = buildExamSnapshot(source(), FIXED_RANDOM_INT);
    expect(() =>
      toExamResultView({
        attempt: terminalAttempt(),
        snapshot: { payload },
        result: {
          score: 100,
          maxScore: 200,
          passed: true,
          scoringVersion: 'exam-score-v1',
          publishedAt: GRADED_AT,
          detail: broken,
          skillScores: [],
        },
      }),
    ).toThrow('Exam result is unavailable.');
  });

  it('pins the review allow-list and the snapshot question order', () => {
    const view = reviewView();

    expect(Object.keys(view).sort()).toEqual([
      'attemptId',
      'questions',
      'startedAt',
      'status',
      'submittedAt',
      'testTitle',
    ]);
    expect(view.questions.map((question) => question.key)).toEqual([
      'q1',
      'q2',
      'q3',
      'q4',
    ]);
    expect(view.questions.map((question) => question.orderIndex)).toEqual([
      1, 2, 3, 4,
    ]);
    for (const question of view.questions) {
      expect(Object.keys(question).sort()).toEqual([
        'answers',
        'audio',
        'content',
        'correctAnswer',
        'explanation',
        'image',
        'isCorrect',
        'key',
        'learnerAnswer',
        'orderIndex',
        'skill',
        'type',
      ]);
      // Q158: media is null for every question in M4.3.
      expect(question.audio).toBeNull();
      expect(question.image).toBeNull();
    }
    expect(view.questions.map((question) => question.isCorrect)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it('returns learnerAnswer null for a blank question and the stored shape otherwise', () => {
    const questions = reviewView().questions;
    expect(questions[0]?.learnerAnswer).toEqual({ choice: 'a' });
    // q2/q3 have no stored row at all, q4 has a cleared JSON null.
    expect(questions[1]?.learnerAnswer).toBeNull();
    expect(questions[2]?.learnerAnswer).toBeNull();
    expect(questions[3]?.learnerAnswer).toBeNull();
    // The answer key and explanation are the frozen snapshot copies.
    expect(questions[0]?.correctAnswer).toEqual({ optionId: 'a' });
    expect(questions[0]?.explanation).toBe('Vì A đúng.');
    // Renderable answer payload only, like the attempt view.
    expect(questions[0]?.answers).toEqual({
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
    });
    expect(questions[2]?.answers).toEqual({});
    expect(questions[3]?.answers).toEqual({});
  });

  it('keeps arrange ids in the masked snapshot space in all three places', () => {
    const arrange = reviewView().questions[1];
    if (arrange === undefined) throw new Error('arrange question missing');
    const tokenIds = (
      arrange.answers as { tokens: Array<{ id: string }> }
    ).tokens.map((token) => token.id);
    const correct = (arrange.correctAnswer as { tokenIds: string[] }).tokenIds;

    expect(tokenIds).toEqual(['t1', 't2', 't3']);
    expect([...correct].sort()).toEqual([...tokenIds].sort());
    // TL-133: the authored ids (t3/t1/t2 in the live fixture) never appear; the
    // snapshot renumbered them per attempt.
    expect(correct).not.toEqual(['t3', 't1', 't2']);
  });

  it('fails closed when the stored breakdown misses a snapshot question', () => {
    const broken = detail();
    broken.questions = broken.questions.filter(
      (question) => question.key !== 'q3',
    );
    const { payload } = buildExamSnapshot(source(), FIXED_RANDOM_INT);
    expect(() =>
      toExamReviewView({
        attempt: terminalAttempt(),
        snapshot: { payload },
        result: { detail: broken },
        answers: [],
      }),
    ).toThrow('Exam result is unavailable.');
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
