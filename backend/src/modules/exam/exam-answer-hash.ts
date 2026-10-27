import {
  CanonicalJsonDepthError,
  sha256CanonicalJson,
} from '../../common/utils/canonical-json';

/**
 * F2: the answer body is unvalidated client JSON until the shape validator has
 * accepted it, and even then a retry may arrive with a body that cannot be
 * canonicalised (too deep, or not a plain JSON object). A body that cannot be
 * hashed is a bad request, never a server fault — `null` lets the caller answer
 * `400 EXAM_ANSWER_INVALID` with `field = answer`.
 */
export type ExamAnswerHashBody = {
  questionKey: string;
  answer: unknown;
  isFlagged: boolean;
  expectedVersion: number | null;
};

/** The four canonical fields of the replay ledger, built in one place. */
export function toExamAnswerHashBody(
  questionKey: string,
  body: {
    answer: unknown;
    isFlagged: boolean;
    expectedVersion: number | null;
  },
): ExamAnswerHashBody {
  return {
    questionKey,
    answer: body.answer,
    isFlagged: body.isFlagged,
    expectedVersion: body.expectedVersion,
  };
}

export function tryExamAnswerBodySha256(
  body: ExamAnswerHashBody,
): string | null {
  try {
    return sha256CanonicalJson({
      questionKey: body.questionKey,
      answer: body.answer,
      isFlagged: body.isFlagged,
      expectedVersion: body.expectedVersion,
    });
  } catch (error: unknown) {
    if (
      error instanceof CanonicalJsonDepthError ||
      error instanceof TypeError
    ) {
      return null;
    }
    throw error;
  }
}
