/**
 * Units ("Đơn vị học") of the lesson page, one per public Topic (PO
 * 20/11/2026, L1–L13, N1–N9). Pure and Zod-free so client components may
 * import it.
 */

import { wholePercent } from '@/features/learner-home/percent';

type ProgressStatus = 'not_started' | 'learning' | 'done';
type Exercise = { latestAttempt: unknown };

export type LessonUnitsInput = {
  topics: ReadonlyArray<{
    id: number;
    title: string;
    subtitle: string | null;
    type: string;
    orderIndex: number;
    progress: { status: ProgressStatus; completionPercent: number };
    exercises: readonly Exercise[];
  }>;
  /** Exercises without a topic; they count into Kiểm tra (N1). */
  standaloneExercises: readonly Exercise[];
  words: ReadonlyArray<{ hanzi: string; topicId: number | null }>;
};

export type LessonUnitKind = 'vocabulary' | 'grammar' | 'key_text' | 'quiz';

export type LessonUnit = {
  key: string;
  kind: LessonUnitKind;
  title: string;
  meta: string;
  /** `zh-Hans` when `meta` is the word preview of a vocabulary unit. */
  metaLang: 'zh-Hans' | null;
  /** Existing page the row opens; the step-by-step flow is Pha C. */
  slug: 'vocabulary' | 'grammar' | 'practice';
  percent: number;
  done: boolean;
  locked: boolean;
};

/** Letter badge per unit (mẫu lesson-units.html `.lu-badge`). */
export const LESSON_UNIT_BADGES: Record<
  LessonUnitKind,
  { char: string; tone: string }
> = {
  vocabulary: { char: '词', tone: 'is-jade' },
  grammar: { char: '语', tone: 'is-violet' },
  key_text: { char: '文', tone: 'is-amber' },
  quiz: { char: '测', tone: 'is-blue' },
};

const PREVIEW_WORDS = 4;

/** 0..99: only a done unit reads 100% (it shows Xong instead). */
function unfinishedPercent(value: number): number {
  return Math.min(99, wholePercent(value));
}
const QUIZ_LOCKED_META = 'Mở khi xong các đơn vị trên';

export function lessonUnits(
  input: LessonUnitsInput,
  lessonLocked: boolean,
): LessonUnit[] {
  const topics = [...input.topics].sort(
    (left, right) => left.orderIndex - right.orderIndex || left.id - right.id,
  );
  const units: LessonUnit[] = [];
  let vocabularyCount = 0;
  let quizIndex: number | null = null;
  const quizTopics: LessonUnitsInput['topics'][number][] = [];

  for (const topic of topics) {
    if (topic.type === 'quiz') {
      quizIndex ??= units.length;
      quizTopics.push(topic);
      continue;
    }
    const done = !lessonLocked && topic.progress.status === 'done';
    const base = {
      key: `topic-${topic.id}`,
      percent: done ? 100 : unfinishedPercent(topic.progress.completionPercent),
      done,
      locked: lessonLocked,
      metaLang: null,
    };
    if (topic.type === 'vocabulary') {
      vocabularyCount += 1;
      const preview = input.words
        .filter((word) => word.topicId === topic.id)
        .slice(0, PREVIEW_WORDS)
        .map((word) => word.hanzi);
      units.push({
        ...base,
        kind: 'vocabulary',
        title: `Từ vựng ${vocabularyCount}`,
        ...(preview.length > 0
          ? { meta: preview.join(' · '), metaLang: 'zh-Hans' as const }
          : { meta: topic.subtitle?.trim() || topic.title }),
        slug: 'vocabulary',
      });
    } else if (topic.type === 'grammar' || topic.type === 'key_text') {
      units.push({
        ...base,
        kind: topic.type,
        title: topic.type === 'grammar' ? 'Ngữ pháp' : 'Bài khoá',
        meta: topic.title,
        slug: 'grammar',
      });
    }
    // ai_speaking and unknown types stay hidden.
  }

  const exercises = [
    ...quizTopics.flatMap((topic) => topic.exercises),
    ...input.standaloneExercises,
  ];
  if (quizTopics.length > 0 || exercises.length > 0) {
    const attempted = exercises.filter(
      (exercise) => exercise.latestAttempt !== null,
    ).length;
    const done =
      !lessonLocked &&
      attempted === exercises.length &&
      quizTopics.every((topic) => topic.progress.status === 'done');
    const position = quizIndex ?? units.length;
    // N2: only the units before Kiểm tra gate it.
    const waiting = units.slice(0, position).some((unit) => !unit.done);
    const locked = lessonLocked || waiting;
    units.splice(position, 0, {
      key: 'quiz',
      kind: 'quiz',
      title: 'Kiểm tra',
      meta:
        !lessonLocked && waiting
          ? QUIZ_LOCKED_META
          : `${exercises.length} bài tập`,
      metaLang: null,
      slug: 'practice',
      percent: done
        ? 100
        : exercises.length > 0
          ? unfinishedPercent((attempted / exercises.length) * 100)
          : 0,
      done,
      locked,
    });
  }
  return units;
}

/** Route id must be a positive int32 before any backend call (Q41). */
export function parseLessonId(raw: string): number | null {
  if (!/^[1-9]\d*$/u.test(raw)) return null;
  const id = Number(raw);
  return id <= 2_147_483_647 ? id : null;
}
