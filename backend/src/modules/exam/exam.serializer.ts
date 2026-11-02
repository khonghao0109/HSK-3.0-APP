import {
  ExamAttemptStatus,
  QuestionType,
  type Prisma,
  type Skill,
} from '@prisma/client';

import type {
  ExamAnswerSaveViewDto,
  ExamAnswerViewDto,
  ExamAttemptViewDto,
  ExamQuestionAnswersDto,
  ExamQuestionOptionDto,
  ExamResultViewDto,
  ExamReviewViewDto,
  ExamTestIntroDto,
  ExamTestListItemDto,
} from './dto/exam-response.dto';
import { ExamResultInternalError } from './exam-errors';
import {
  collectExamTestSkills,
  deriveExamListStatus,
  type ExamListSectionRef,
} from './exam-list.model';
import type { ExamResultDetail } from './exam-result.reader';
import {
  EXAM_SECTION_MAX_SCORE,
  type ExamSnapshotGroup,
  type ExamSnapshotMedia,
  type ExamSnapshotPayload,
  type ExamSnapshotQuestion,
  type ExamSnapshotSection,
} from './exam-snapshot.builder';

/**
 * R11 / TL-114: both bodies are built by copying an allow-list of fields into
 * a new object. Nothing is spread or copied wholesale, so the frozen
 * `correctAnswer`/`explanation` (and every internal identity such as
 * `questionId`/`contentHash`) can never reach a learner while the attempt is
 * still in progress.
 */

export type ExamTestIntroSectionSource = {
  orderIndex: number;
  title: string;
  skill: Skill;
  questionCount: number;
};

export type ExamTestIntroSource = {
  test: {
    id: number;
    title: string;
    instruction: string | null;
    levelCode: string;
    /** Whole-test duration in minutes (Q118). */
    duration: number;
    passScore: number | null;
    maxScore: number;
    questionCount: number;
    sections: ExamTestIntroSectionSource[];
  };
  activeAttempt: {
    id: number;
    startedAt: Date;
    expiresAt: Date;
    answeredCount: number;
  } | null;
};

export type ExamAttemptRecord = {
  id: number;
  testId: number;
  status: ExamAttemptStatus;
  startedAt: Date;
  expiresAt: Date;
  maxScore: number | null;
};

export type ExamStoredAnswer = {
  snapshotQuestionKey: string;
  answer: Prisma.JsonValue;
  isFlagged: boolean;
  version: number;
  answeredAt: Date | null;
  lastSavedAt: Date;
};

export type ExamAttemptViewSource = {
  attempt: ExamAttemptRecord;
  snapshot: { payload: ExamSnapshotPayload };
  now: Date;
  answers: ExamStoredAnswer[];
};

/** Terminal states only, matching the result/review DTO (TL-165/TL-166). */
export type ExamTerminalStatus = 'submitted' | 'timed_out';

/** The committed fields of a terminal attempt serving result/review. */
export type ExamTerminalAttemptRecord = {
  id: number;
  testId: number;
  status: ExamTerminalStatus;
  startedAt: Date;
  submittedAt: Date;
};

/**
 * TL-165: the persisted grading output plus the `ResultSkillScore` rows. The
 * fields written once by `ensureAttemptResult` (`scoringVersion`,
 * `publishedAt`) are non-null because the service fails closed on an incomplete
 * row; `maxScore`/`passed` stay nullable in the schema and are projected as
 * `maxScore ?? snapshot maxScore` / `passed` (Q145).
 */
export type ExamResultViewRecord = {
  score: number;
  maxScore: number | null;
  passed: boolean | null;
  scoringVersion: string;
  publishedAt: Date;
  detail: ExamResultDetail;
  skillScores: Array<{ skill: Skill; score: number; total: number }>;
};

export type ExamResultViewSource = {
  attempt: ExamTerminalAttemptRecord;
  snapshot: { payload: ExamSnapshotPayload };
  result: ExamResultViewRecord;
};

/** TL-166: the frozen snapshot plus the stored answer rows. */
export type ExamReviewViewSource = {
  attempt: ExamTerminalAttemptRecord;
  snapshot: { payload: ExamSnapshotPayload };
  result: { detail: ExamResultDetail };
  answers: Array<Pick<ExamStoredAnswer, 'snapshotQuestionKey' | 'answer'>>;
};

export function toExamTestIntro(source: ExamTestIntroSource): ExamTestIntroDto {
  const { test, activeAttempt } = source;
  return {
    id: test.id,
    title: test.title,
    instruction: test.instruction,
    levelCode: test.levelCode,
    durationMinutes: test.duration,
    questionCount: test.questionCount,
    sectionCount: test.sections.length,
    maxScore: test.maxScore,
    passScore: test.passScore,
    sections: test.sections.map((section) => ({
      orderIndex: section.orderIndex,
      title: section.title,
      skill: section.skill,
      questionCount: section.questionCount,
      maxScore: EXAM_SECTION_MAX_SCORE,
    })),
    activeAttempt:
      activeAttempt === null
        ? null
        : {
            id: activeAttempt.id,
            startedAt: activeAttempt.startedAt,
            expiresAt: activeAttempt.expiresAt,
            answeredCount: activeAttempt.answeredCount,
            questionCount: test.questionCount,
          },
  };
}

export function toExamAttemptView(
  source: ExamAttemptViewSource,
): ExamAttemptViewDto {
  const { attempt, snapshot, now, answers } = source;
  const payload = snapshot.payload;
  const questions = payload.sections.flatMap((section) =>
    section.groups.flatMap((group) => group.questions),
  );

  return {
    id: attempt.id,
    testId: attempt.testId,
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    serverNow: now,
    // TL-152: a closed attempt has no running clock, even if the learner
    // submitted before its deadline. The client uses `status` to lock the
    // screen; a positive remaining time would contradict that.
    remainingSeconds:
      attempt.status === ExamAttemptStatus.in_progress
        ? remainingSeconds(attempt.expiresAt, now)
        : 0,
    maxScore: attempt.maxScore ?? payload.test.maxScore,
    questionCount: questions.length,
    test: {
      title: payload.test.title,
      instruction: payload.test.instruction,
      levelCode: payload.test.levelCode,
      durationMinutes: payload.test.durationMinutes,
      passScore: payload.test.passScore,
    },
    sections: payload.sections.map((section) => projectSection(section)),
    answers: answers.map((answer) => toExamAnswerView(answer)),
  };
}

/**
 * TL-127: the answer projection shared by GET attempt and the save response.
 * Copying an allow-list keeps internal columns (`questionId`, `score`,
 * `detailJson`, `saveIdempotencyKey`) out of every learner body (R11).
 */
export function toExamAnswerView(answer: ExamStoredAnswer): ExamAnswerViewDto {
  return {
    questionKey: answer.snapshotQuestionKey,
    answer: answer.answer,
    isFlagged: answer.isFlagged,
    version: answer.version,
    answeredAt: answer.answeredAt,
    lastSavedAt: answer.lastSavedAt,
  };
}

/** TL-121: the 200 body of a single answer save. */
export function toExamAnswerSaveView(input: {
  answer: ExamStoredAnswer;
  now: Date;
  expiresAt: Date;
}): ExamAnswerSaveViewDto {
  return {
    ...toExamAnswerView(input.answer),
    serverNow: input.now,
    remainingSeconds: remainingSeconds(input.expiresAt, input.now),
  };
}

export function remainingSeconds(expiresAt: Date, now: Date): number {
  const remaining = Math.floor((expiresAt.getTime() - now.getTime()) / 1_000);
  return remaining > 0 ? remaining : 0;
}

/**
 * TL-165/Q151: the result view is an allow-listed projection of the stored
 * `Result` row, its `detailJson` breakdown and the frozen snapshot. Section
 * titles and the frozen pass line come from the snapshot (Q148/Q151), the
 * skill totals from `ResultSkillScore` rows, and nothing is re-graded.
 */
export function toExamResultView(
  source: ExamResultViewSource,
): ExamResultViewDto {
  const { attempt, snapshot, result } = source;
  const payload = snapshot.payload;
  const titlesByKey = new Map(
    payload.sections.map((section) => [section.key, section.title]),
  );

  return {
    attemptId: attempt.id,
    testId: attempt.testId,
    status: attempt.status,
    testTitle: payload.test.title,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    score: result.score,
    maxScore: result.maxScore ?? payload.test.maxScore,
    passScore: payload.test.passScore,
    passed: result.passed,
    scoringVersion: result.scoringVersion,
    gradedAt: result.publishedAt,
    // The DTO is the reader's validated counts object; copying field by field
    // would let the persisted contract and the response drift apart.
    counts: result.detail.counts,
    sections: result.detail.sections.map((section) => {
      const title = titlesByKey.get(section.key);
      if (title === undefined) {
        // A persisted breakdown that names an unknown section is a data bug:
        // fail closed rather than serve an incomplete result (TL-179).
        throw new ExamResultInternalError('unknown_section');
      }
      return {
        key: section.key,
        title,
        skill: section.skill,
        questionCount: section.questionCount,
        correctCount: section.correctCount,
        score: section.score,
        maxScore: section.maxScore,
      };
    }),
    skills: result.skillScores.map((skill) => ({
      skill: skill.skill,
      score: skill.score,
      maxScore: skill.total,
    })),
    weakAreas: result.detail.weakAreas.map((area) => ({
      slug: area.slug,
      name: area.name,
      answered: area.answered,
      correct: area.correct,
      accuracy: area.accuracy,
      level: area.level,
    })),
  };
}

/**
 * TL-166/Q148/Q158: the post-terminal review. Question order is the frozen
 * snapshot order (section → group → question), `correctAnswer`/`explanation`
 * are the snapshot copies (never the live question row), and `isCorrect` comes
 * from `Result.detailJson.questions` — the single grading source of truth.
 * Media is always `null` in M4.3 (Q158); grants arrive in M4.5.
 */
export function toExamReviewView(
  source: ExamReviewViewSource,
): ExamReviewViewDto {
  const { attempt, snapshot, result, answers } = source;
  const payload = snapshot.payload;
  const answerByKey = new Map(
    answers.map((answer) => [answer.snapshotQuestionKey, answer.answer]),
  );
  const correctnessByKey = new Map(
    result.detail.questions.map((question) => [
      question.key,
      question.isCorrect,
    ]),
  );

  const questions = payload.sections.flatMap((section) =>
    section.groups.flatMap((group) =>
      group.questions.map((question) => {
        const isCorrect = correctnessByKey.get(question.key);
        if (isCorrect === undefined) {
          // The review must never guess a grading outcome (TL-179).
          throw new ExamResultInternalError('missing_graded_question');
        }
        const learnerAnswer = answerByKey.get(question.key);
        return {
          key: question.key,
          orderIndex: question.orderIndex,
          type: question.type,
          skill: question.skill,
          content: question.content,
          answers: projectAnswers(question.type, question.answers),
          learnerAnswer: learnerAnswer ?? null,
          correctAnswer: question.correctAnswer,
          explanation: question.explanation,
          isCorrect,
          audio: null,
          image: null,
        };
      }),
    ),
  );

  return {
    attemptId: attempt.id,
    status: attempt.status,
    testTitle: payload.test.title,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    questions,
  };
}

function projectSection(section: ExamSnapshotSection) {
  return {
    key: section.key,
    orderIndex: section.orderIndex,
    title: section.title,
    instruction: section.instruction,
    skill: section.skill,
    groups: section.groups.map((group) => projectGroup(group)),
  };
}

function projectGroup(group: ExamSnapshotGroup) {
  return {
    key: group.key,
    orderIndex: group.orderIndex,
    title: group.title,
    instruction: group.instruction,
    content: group.content,
    audio: projectMedia(group.audio),
    image: projectMedia(group.image),
    questions: group.questions.map((question) => projectQuestion(question)),
  };
}

function projectQuestion(question: ExamSnapshotQuestion) {
  return {
    key: question.key,
    orderIndex: question.orderIndex,
    type: question.type,
    skill: question.skill,
    content: question.content,
    answers: projectAnswers(question.type, question.answers),
    audio: projectMedia(question.audio),
    image: projectMedia(question.image),
  };
}

function projectMedia(media: ExamSnapshotMedia | null) {
  if (media === null) return null;
  return {
    mediaId: media.mediaId,
    kind: media.kind,
    mimeType: media.mimeType,
    durationMs: media.durationMs,
  };
}

/**
 * Only the renderable part of a question's answer payload is exposed; the
 * authoring form may store extra keys (grading rules, correctness flags), and
 * those are dropped here by construction rather than deleted afterwards.
 */
function projectAnswers(
  type: QuestionType,
  answers: Prisma.JsonValue,
): ExamQuestionAnswersDto {
  if (type === QuestionType.mcq) {
    return { options: projectOptionList(answers, 'options') };
  }
  if (type === QuestionType.arrange_sentence) {
    // TL-133: tokens were shuffled and renumbered inside the frozen snapshot.
    return { tokens: projectOptionList(answers, 'tokens') };
  }
  return {};
}

function projectOptionList(
  answers: Prisma.JsonValue,
  key: 'options' | 'tokens',
): ExamQuestionOptionDto[] {
  if (
    answers === null ||
    typeof answers !== 'object' ||
    Array.isArray(answers)
  ) {
    return [];
  }
  const value = answers[key];
  if (!Array.isArray(value)) return [];

  const items: ExamQuestionOptionDto[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const id = item.id;
    const text = item.text;
    if (typeof id === 'string' && typeof text === 'string') {
      items.push({ id, text });
    }
  }
  return items;
}

/** M4.5 B1: the attempt rows the list projection is allowed to read. */
export type ExamTestListActiveAttemptSource = {
  id: number;
  expiresAt: Date;
};

export type ExamTestListLatestAttemptSource = {
  id: number;
  /** Terminal, non-invalidated status (Q213). */
  status: 'submitted' | 'timed_out';
  submittedAt: Date;
  /** `Result.score`; `null` when the finished attempt is not graded. */
  score: number | null;
  /** `Result.maxScore` falling back to the frozen attempt maximum. */
  maxScore: number | null;
  resultAvailable: boolean;
};

export type ExamTestListSource = {
  test: {
    id: number;
    title: string;
    levelCode: string;
    /** Whole-test duration in minutes (Q118). */
    duration: number;
    questionCount: number;
    sections: ExamListSectionRef[];
  };
  activeAttempt: ExamTestListActiveAttemptSource | null;
  latestAttempt: ExamTestListLatestAttemptSource | null;
};

/**
 * Q210–Q214: one list card. Fields are copied one by one (no spread), so an
 * attempt row that is not the caller's cannot leak through a future `include`.
 * The list never returns answer content, scores of unfinished attempts, or the
 * test's live structure beyond the skill order.
 */
export function toExamTestListItem(
  source: ExamTestListSource,
): ExamTestListItemDto {
  const { test, activeAttempt, latestAttempt } = source;
  return {
    testId: test.id,
    title: test.title,
    levelCode: test.levelCode,
    duration: test.duration,
    questionCount: test.questionCount,
    skills: collectExamTestSkills(test.sections),
    status: deriveExamListStatus(
      activeAttempt !== null,
      latestAttempt !== null,
    ),
    activeAttempt:
      activeAttempt === null
        ? null
        : { attemptId: activeAttempt.id, expiresAt: activeAttempt.expiresAt },
    latestAttempt:
      latestAttempt === null
        ? null
        : {
            attemptId: latestAttempt.id,
            status: latestAttempt.status,
            score: latestAttempt.score,
            maxScore: latestAttempt.maxScore,
            submittedAt: latestAttempt.submittedAt,
            resultAvailable: latestAttempt.resultAvailable,
          },
  };
}
