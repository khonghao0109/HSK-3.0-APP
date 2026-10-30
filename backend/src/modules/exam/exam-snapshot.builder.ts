import { randomInt as cryptoRandomInt } from 'node:crypto';

import {
  MediaType,
  QuestionType,
  type Prisma,
  type Skill,
} from '@prisma/client';

import { sha256CanonicalJson } from '../../common/utils/canonical-json';
import type { CmsMediaRecord } from '../cms/media-usability';

/**
 * TL-113 / Q121: the immutable exam snapshot. The payload is written once, in
 * the same transaction that creates the attempt, and it is the only source for
 * rendering the exam and for grading afterwards — editing a Question later
 * (Q116) cannot change an attempt that already started.
 */
export const EXAM_SNAPSHOT_SCHEMA_VERSION = 1;

/** 100 points per section, so maxScore = 100 × sectionCount (Q118). */
export const EXAM_SECTION_MAX_SCORE = 100;

export type ExamSnapshotMedia = {
  mediaId: number;
  kind: MediaType;
  mimeType: string | null;
  durationMs: number | null;
};

export type ExamSnapshotQuestion = {
  key: string;
  orderIndex: number;
  questionId: number;
  questionVersion: number;
  type: QuestionType;
  skill: Skill;
  content: string;
  answers: Prisma.JsonValue;
  audio: ExamSnapshotMedia | null;
  image: ExamSnapshotMedia | null;
  correctAnswer: Prisma.JsonValue;
  explanation: string | null;
};

export type ExamSnapshotGroup = {
  key: string;
  orderIndex: number;
  title: string | null;
  instruction: string | null;
  content: Prisma.JsonValue | null;
  audio: ExamSnapshotMedia | null;
  image: ExamSnapshotMedia | null;
  questions: ExamSnapshotQuestion[];
};

export type ExamSnapshotSection = {
  key: string;
  orderIndex: number;
  skill: Skill;
  title: string;
  instruction: string | null;
  maxScore: number;
  groups: ExamSnapshotGroup[];
};

export type ExamSnapshotTest = {
  id: number;
  title: string;
  instruction: string | null;
  levelCode: string;
  durationMinutes: number;
  passScore: number | null;
  maxScore: number;
  scoringVersion: string;
};

export type ExamSnapshotPayload = {
  schemaVersion: number;
  test: ExamSnapshotTest;
  sections: ExamSnapshotSection[];
};

/** One question as read from the locked tree, before it is keyed by placement. */
export type ExamSnapshotSourceQuestion = {
  placementOrderIndex: number;
  question: {
    id: number;
    version: number;
    type: QuestionType;
    skill: Skill;
    content: string;
    answers: Prisma.JsonValue;
    correctAnswer: Prisma.JsonValue;
    explanation: string | null;
    audio: ExamSnapshotMedia | null;
    image: ExamSnapshotMedia | null;
  };
};

export type ExamSnapshotSourceGroup = {
  orderIndex: number;
  title: string | null;
  instruction: string | null;
  content: Prisma.JsonValue | null;
  audio: ExamSnapshotMedia | null;
  image: ExamSnapshotMedia | null;
  questions: ExamSnapshotSourceQuestion[];
};

export type ExamSnapshotSourceSection = {
  orderIndex: number;
  skill: Skill;
  title: string;
  instruction: string | null;
  groups: ExamSnapshotSourceGroup[];
};

export type ExamSnapshotSource = {
  test: {
    id: number;
    title: string;
    instruction: string | null;
    levelCode: string;
    /** Whole-test duration in minutes (Q118). */
    duration: number;
    passScore: number | null;
    /** Live value; the builder recomputes it from the frozen structure. */
    maxScore: number;
    scoringVersion: string;
    version: number;
  };
  sections: ExamSnapshotSourceSection[];
};

export type BuiltExamSnapshot = {
  payload: ExamSnapshotPayload;
  contentHash: string;
  testVersion: number;
  snapshotVersion: number;
};

/**
 * The snapshot keeps only the media fields a learner player needs; storage
 * keys, checksums and provenance stay out of the payload.
 */
export function projectExamSnapshotMedia(
  media: CmsMediaRecord | null,
): ExamSnapshotMedia | null {
  if (media === null) return null;
  return {
    mediaId: media.id,
    kind: media.type,
    mimeType: media.mimeType,
    durationMs: media.duration,
  };
}

export type ArrangeRandomInt = (maxExclusive: number) => number;

export type ArrangeTokenMask = {
  answers: Prisma.JsonValue;
  correctAnswer: Prisma.JsonValue;
};

/** TL-133: how many times to re-shuffle before forcing a different order. */
const ARRANGE_MASK_MAX_ATTEMPTS = 32;

/**
 * TL-133: the authoring form stores `answers.tokens` in the correct order and
 * derives `correctAnswer.tokenIds` from that same array, so keeping the stored
 * order in the snapshot hands the learner the answer. The mask shuffles with
 * Fisher–Yates, refuses an arrangement whose text order still equals the
 * correct sentence, and renumbers ids by display position (`t1…tn`) so even
 * sorting by id cannot recover the answer. The snapshot is built once per
 * attempt and stored immutably, so both the order and the ids are local to that
 * attempt.
 *
 * The publish validator already rejects malformed tokens/answers, so a payload
 * that cannot be reinterpreted here is returned untouched rather than repaired
 * (a live row edited after publish must not break start).
 */
export function maskArrangeTokens(
  answers: Prisma.JsonValue,
  correctAnswer: Prisma.JsonValue,
  randomInt: ArrangeRandomInt,
): ArrangeTokenMask {
  const answersRecord = plainRecord(answers);
  const correctRecord = plainRecord(correctAnswer);
  const tokens = parseTokens(answersRecord);
  const tokenIds = parseTokenIds(correctRecord, tokens);
  if (tokens === null || tokenIds === null) {
    return { answers, correctAnswer };
  }

  const textById = new Map(tokens.map((token) => [token.id, token.text]));
  const correctTexts = tokenIds.map((id) => (textById.get(id) ?? '').trim());
  const textOrder = (arrangement: ArrangeToken[]): string[] =>
    arrangement.map((token) => token.text.trim());
  const isAnswerOrder = (arrangement: ArrangeToken[]): boolean => {
    const texts = textOrder(arrangement);
    return (
      texts.length === correctTexts.length &&
      texts.every((text, index) => text === correctTexts[index])
    );
  };
  const allSameText = tokens.every(
    (token) => token.text.trim() === tokens[0]?.text.trim(),
  );

  let shuffled = shuffle(tokens, randomInt);
  if (!allSameText) {
    let attempts = 0;
    while (isAnswerOrder(shuffled) && attempts < ARRANGE_MASK_MAX_ATTEMPTS) {
      shuffled = shuffle(tokens, randomInt);
      attempts += 1;
    }
    if (isAnswerOrder(shuffled)) {
      shuffled = swapFirstDifferent(shuffled);
    }
  }

  const newIdByOldId = new Map<string, string>();
  const maskedTokens = shuffled.map((token, index) => {
    const id = `t${String(index + 1)}`;
    newIdByOldId.set(token.id, id);
    return { id, text: token.text };
  });
  const maskedTokenIds = tokenIds.map((id) => newIdByOldId.get(id) ?? id);

  return {
    answers: { ...answersRecord, tokens: maskedTokens },
    correctAnswer: { ...correctRecord, tokenIds: maskedTokenIds },
  };
}

type ArrangeToken = { id: string; text: string };

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseTokens(
  answers: Record<string, unknown> | null,
): ArrangeToken[] | null {
  if (answers === null) return null;
  const raw = answers.tokens;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const tokens: ArrangeToken[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const record = plainRecord(item);
    if (record === null) return null;
    const { id, text } = record;
    if (typeof id !== 'string' || typeof text !== 'string') return null;
    if (seen.has(id)) return null;
    seen.add(id);
    tokens.push({ id, text });
  }
  return tokens;
}

function parseTokenIds(
  correctAnswer: Record<string, unknown> | null,
  tokens: ArrangeToken[] | null,
): string[] | null {
  if (correctAnswer === null || tokens === null) return null;
  const raw = correctAnswer.tokenIds;
  if (!Array.isArray(raw) || raw.length !== tokens.length) return null;
  const known = new Set(tokens.map((token) => token.id));
  const seen = new Set<string>();
  const tokenIds: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !known.has(item) || seen.has(item)) {
      return null;
    }
    seen.add(item);
    tokenIds.push(item);
  }
  return tokenIds;
}

function shuffle(
  tokens: ArrangeToken[],
  randomInt: ArrangeRandomInt,
): ArrangeToken[] {
  const result = [...tokens];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = result[index];
    const other = result[swapIndex];
    if (current === undefined || other === undefined) continue;
    result[index] = other;
    result[swapIndex] = current;
  }
  return result;
}

/** Last resort when the RNG keeps producing the answer order (or identity). */
function swapFirstDifferent(tokens: ArrangeToken[]): ArrangeToken[] {
  const first = tokens[0];
  if (first === undefined) return tokens;
  const index = tokens.findIndex(
    (token, position) =>
      position > 0 && token.text.trim() !== first.text.trim(),
  );
  if (index === -1) return tokens;
  const result = [...tokens];
  const other = result[index];
  if (other === undefined) return tokens;
  result[0] = other;
  result[index] = first;
  return result;
}

/**
 * `key` values are the identity used by `ExamAnswer.snapshotQuestionKey` in
 * M4.2b: `s<order>`, `s<order>-g<order>` and `q<placement order>`.
 */
export function buildExamSnapshot(
  source: ExamSnapshotSource,
  randomInt: ArrangeRandomInt = cryptoRandomInt,
): BuiltExamSnapshot {
  const maxScore = EXAM_SECTION_MAX_SCORE * source.sections.length;
  const payload: ExamSnapshotPayload = {
    schemaVersion: EXAM_SNAPSHOT_SCHEMA_VERSION,
    test: {
      id: source.test.id,
      title: source.test.title,
      instruction: source.test.instruction,
      levelCode: source.test.levelCode,
      durationMinutes: source.test.duration,
      passScore: source.test.passScore,
      maxScore,
      scoringVersion: source.test.scoringVersion,
    },
    sections: source.sections.map((section) => ({
      key: `s${String(section.orderIndex)}`,
      orderIndex: section.orderIndex,
      skill: section.skill,
      title: section.title,
      instruction: section.instruction,
      maxScore: EXAM_SECTION_MAX_SCORE,
      groups: section.groups.map((group) => ({
        key: `s${String(section.orderIndex)}-g${String(group.orderIndex)}`,
        orderIndex: group.orderIndex,
        title: group.title,
        instruction: group.instruction,
        content: group.content,
        audio: group.audio,
        image: group.image,
        questions: group.questions.map((entry) => {
          // TL-133: the authoring form stores the answer order, so the frozen
          // copy shuffles and renumbers arrange tokens here — the snapshot is
          // built per attempt and stored immutably (`ExamAttemptSnapshot.attemptId`
          // is unique), which is what makes the masking per-attempt.
          const projected =
            entry.question.type === QuestionType.arrange_sentence
              ? maskArrangeTokens(
                  entry.question.answers,
                  entry.question.correctAnswer,
                  randomInt,
                )
              : {
                  answers: entry.question.answers,
                  correctAnswer: entry.question.correctAnswer,
                };
          return {
            key: `q${String(entry.placementOrderIndex)}`,
            orderIndex: entry.placementOrderIndex,
            questionId: entry.question.id,
            questionVersion: entry.question.version,
            type: entry.question.type,
            skill: entry.question.skill,
            content: entry.question.content,
            answers: projected.answers,
            audio: entry.question.audio,
            image: entry.question.image,
            correctAnswer: projected.correctAnswer,
            explanation: entry.question.explanation,
          };
        }),
      })),
    })),
  };

  return {
    payload,
    contentHash: sha256CanonicalJson(payload),
    testVersion: source.test.version,
    snapshotVersion: EXAM_SNAPSHOT_SCHEMA_VERSION,
  };
}
