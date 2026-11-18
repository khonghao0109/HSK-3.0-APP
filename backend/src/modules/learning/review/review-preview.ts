import { schedule, SM2_V1_POLICY } from '../srs';
import type { SrsCard, SrsGrade, SrsScheduleResult } from '../srs';

export interface ReviewGradePreview {
  state: SrsScheduleResult['state'];
  dueAt: Date;
  intervalDays: number;
}

export type ReviewPreview = Record<SrsGrade, ReviewGradePreview>;

/** R4: what each grade would do to `card` at `now`, so the client never schedules. */
export function buildReviewPreview(card: SrsCard, now: Date): ReviewPreview {
  const preview = (grade: SrsGrade): ReviewGradePreview => {
    const next = schedule(card, grade, now, SM2_V1_POLICY);
    return {
      state: next.state,
      dueAt: next.dueAt,
      intervalDays: next.intervalDays,
    };
  };
  return {
    again: preview('again'),
    hard: preview('hard'),
    good: preview('good'),
    easy: preview('easy'),
  };
}
