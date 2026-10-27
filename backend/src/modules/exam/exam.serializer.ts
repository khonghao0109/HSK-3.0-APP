import {
  QuestionType,
  type ExamAttemptStatus,
  type Prisma,
  type Skill,
} from '@prisma/client';

import type {
  ExamAttemptViewDto,
  ExamQuestionAnswersDto,
  ExamQuestionOptionDto,
  ExamTestIntroDto,
} from './dto/exam-response.dto';
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
  lastSavedAt: Date;
};

export type ExamAttemptViewSource = {
  attempt: ExamAttemptRecord;
  snapshot: { payload: ExamSnapshotPayload };
  now: Date;
  answers: ExamStoredAnswer[];
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
    remainingSeconds: remainingSeconds(attempt.expiresAt, now),
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
    answers: answers.map((answer) => ({
      snapshotQuestionKey: answer.snapshotQuestionKey,
      answer: answer.answer,
      isFlagged: answer.isFlagged,
      version: answer.version,
      lastSavedAt: answer.lastSavedAt,
    })),
  };
}

export function remainingSeconds(expiresAt: Date, now: Date): number {
  const remaining = Math.floor((expiresAt.getTime() - now.getTime()) / 1_000);
  return remaining > 0 ? remaining : 0;
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
    // shortcut: tokens keep the stored order; the shuffle is authored data.
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
