import { redirect } from 'next/navigation';

import {
  allVietnamese,
  displayPinyin,
  firstVietnamese,
} from '@/features/learner-dictionary/dictionary-display';

import {
  getLessonActivity,
  getLessonWords,
  getUnitWordDetail,
} from './lesson-activity-service';
import { loadLearnerLesson } from './lesson-page-loader';
import { lessonUnits, parseLessonId, unitHref } from './lesson-sections';
import type { LessonWords, UnitWordDetail } from './lesson-topic-contract';
import { VocabularyUnitFlow } from './vocabulary-unit-flow';
import { type UnitWord, unitSteps } from './vocabulary-unit';

type LessonWord = LessonWords['words'][number];

function unitWord(word: LessonWord, detail: UnitWordDetail | null): UnitWord {
  const example = detail?.examples[0];
  return {
    id: word.id,
    hanzi: word.hanzi,
    pinyin: displayPinyin(word),
    meaning: allVietnamese(word.meanings),
    firstMeaning: firstVietnamese(word.meanings),
    partOfSpeech:
      detail?.meanings
        .find((meaning) => meaning.vi?.trim())
        ?.partOfSpeech?.trim() || null,
    image: word.image,
    // Q311: the old single Word.example only when the API has no examples.
    example: example
      ? {
          hanzi: example.hanzi,
          pinyin: example.pinyin,
          vi: example.vi?.trim() || null,
        }
      : detail?.example
        ? { hanzi: detail.example, pinyin: null, vi: null }
        : null,
  };
}

/**
 * N3 (PO 20/11/2026): one Từ vựng unit as a step flow. Its words are the
 * lesson words of that topic in API order; examples and part of speech come
 * from the dictionary (`GET /dictionary/words/:id`), no new contract. A
 * locked lesson, or a unit that is not a vocabulary topic, goes back to the
 * lesson page (Q40); a vocabulary topic without words opens the word list.
 */
export async function VocabularyUnitView({
  rawId,
  rawUnit,
}: {
  rawId: string;
  rawUnit: string;
}) {
  const topicId = parseLessonId(rawUnit);
  const { lessonId, data } = await loadLearnerLesson(
    rawId,
    async (token, id) => {
      const [activity, lessonWords] = await Promise.all([
        getLessonActivity(token, id),
        getLessonWords(token, id),
      ]);
      const topic = activity.topics.find(
        (candidate) =>
          candidate.id === topicId && candidate.type === 'vocabulary',
      );
      // A locked lesson redirects: no dictionary calls for it.
      const words =
        topic && activity.state !== 'locked'
          ? lessonWords.words.filter((word) => word.topicId === topic.id)
          : [];
      // A word missing from the dictionary just has no example.
      const details = await Promise.all(
        words.map((word) =>
          getUnitWordDetail(token, word.id).catch(() => null),
        ),
      );
      return { activity, lessonWords, topic, words, details };
    },
  );
  const lessonHref = `/learn/lessons/${lessonId}`;
  const { activity, lessonWords, topic, words, details } = data;
  if (activity.state === 'locked' || !topic) redirect(lessonHref);
  // Old lessons: words without a topic stay on the word list page (Q175).
  if (words.length === 0) redirect(`${lessonHref}/vocabulary`);

  // The next unit as it will be once this one is done.
  const units = lessonUnits(
    {
      ...activity,
      topics: activity.topics.map((candidate) =>
        candidate.id === topic.id
          ? {
              ...candidate,
              progress: { status: 'done', completionPercent: 100 },
            }
          : candidate,
      ),
      words: lessonWords.words,
    },
    false,
  );
  const position = units.findIndex((unit) => unit.topicId === topic.id);
  const unit = units[position];
  const next = units[position + 1];

  const unitWords = words.map((word, index) =>
    unitWord(word, details[index] ?? null),
  );
  const pool = lessonWords.words.map((word) => unitWord(word, null));

  return (
    <VocabularyUnitFlow
      lessonId={lessonId}
      topicId={topic.id}
      // Pha F: unit label · lesson title (the topic title repeats the label).
      title={`${unit?.title ?? 'Từ vựng'} · ${activity.lesson.title}`}
      lessonHref={lessonHref}
      nextHref={next && !next.locked ? unitHref(lessonId, next) : null}
      words={unitWords}
      steps={unitSteps(unitWords, pool)}
    />
  );
}
