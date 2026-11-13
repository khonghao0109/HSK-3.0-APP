/**
 * "Nội dung bài học" rows of the lesson page (Q35–Q37, Q44). Pure and
 * Zod-free so client components may import it.
 */

export type LessonSectionCounts = {
  vocabulary: { wordCount: number; topicCount: number; topicsDone: number };
  grammar: { topicCount: number; topicsDone: number };
  practice: { exerciseCount: number; attempted: number };
};

export type LessonRowKind = 'vocabulary' | 'grammar' | 'practice';

export type LessonRow = {
  kind: LessonRowKind;
  title: string;
  meta: string;
  /** `x/N` with its spoken tail; `null` for Từ vựng (Q36) and locked rows. */
  count: { label: string; tail: string; percent: number } | null;
  done: boolean;
  locked: boolean;
};

export const LESSON_ROW_IMAGES: Record<
  LessonRowKind,
  { src: string; width: number; height: number; tone: string }
> = {
  vocabulary: {
    src: '/images/learner/lesson-row-vocab.png',
    width: 36,
    height: 32,
    tone: '',
  },
  grammar: {
    src: '/images/learner/lesson-row-grammar.png',
    width: 36,
    height: 33,
    tone: 'lrow--violet',
  },
  practice: {
    src: '/images/learner/lesson-row-practice.png',
    width: 36,
    height: 31,
    tone: 'lrow--blue',
  },
};

export function lessonRows(
  sections: LessonSectionCounts,
  locked: boolean,
): LessonRow[] {
  const rows: LessonRow[] = [];
  const counted = (done: number, total: number, tail: string) =>
    locked
      ? null
      : { label: `${done}/${total}`, tail, percent: (done / total) * 100 };

  const { vocabulary, grammar, practice } = sections;
  if (vocabulary.wordCount > 0) {
    rows.push({
      kind: 'vocabulary',
      title: 'Từ vựng',
      meta: `${vocabulary.wordCount} từ mới`,
      count: null,
      done:
        !locked &&
        vocabulary.topicCount > 0 &&
        vocabulary.topicsDone === vocabulary.topicCount,
      locked,
    });
  }
  if (grammar.topicCount > 0) {
    rows.push({
      kind: 'grammar',
      title: 'Ngữ pháp',
      meta: `${grammar.topicCount} điểm ngữ pháp`,
      count: counted(grammar.topicsDone, grammar.topicCount, 'đã học'),
      done: false,
      locked,
    });
  }
  if (practice.exerciseCount > 0) {
    rows.push({
      kind: 'practice',
      title: 'Luyện tập',
      meta: `${practice.exerciseCount} bài luyện tập`,
      count: counted(practice.attempted, practice.exerciseCount, 'đã làm'),
      done: false,
      locked,
    });
  }
  return rows;
}

/** Route id must be a positive int32 before any backend call (Q41). */
export function parseLessonId(raw: string): number | null {
  if (!/^[1-9]\d*$/u.test(raw)) return null;
  const id = Number(raw);
  return id <= 2_147_483_647 ? id : null;
}
