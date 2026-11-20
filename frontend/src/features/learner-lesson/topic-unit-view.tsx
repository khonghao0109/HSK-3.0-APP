import { redirect } from 'next/navigation';

import {
  getLessonActivity,
  getLessonTopicActivity,
} from './lesson-activity-service';
import { loadLearnerLesson } from './lesson-page-loader';
import { lessonUnits, parseLessonId, unitHref } from './lesson-sections';
import {
  type GrammarPointBlock,
  type KeyTextBlock,
  topicBlocks,
} from './topic-content';
import { GrammarUnitFlow, KeyTextUnitFlow } from './topic-unit-flow';

/**
 * Pha D: one Ngữ pháp or Bài khoá unit as its own screen. The blocks come
 * from the lesson activity (`Topic.content`, verbatim); the units and the
 * next one from the lesson detail. A locked lesson, or a unit that is not a
 * grammar/key_text topic, goes back to the lesson page (Q40); a grammar
 * topic with only the old `text` blocks opens the Ngữ pháp page that shows
 * them; a Bài khoá shows its `text` blocks as paragraphs.
 */
export async function TopicUnitView({
  rawId,
  rawUnit,
}: {
  rawId: string;
  rawUnit: string;
}) {
  const topicId = parseLessonId(rawUnit);
  const { lessonId, data } = await loadLearnerLesson(rawId, (token, id) =>
    Promise.all([
      getLessonActivity(token, id),
      getLessonTopicActivity(token, id),
    ]),
  );
  const [activity, topicActivity] = data;
  const lessonHref = `/learn/lessons/${lessonId}`;
  const topic = topicActivity.topics.find(
    (candidate) =>
      candidate.id === topicId &&
      (candidate.type === 'grammar' || candidate.type === 'key_text'),
  );
  if (activity.state === 'locked' || !topic) redirect(lessonHref);

  const blocks = topicBlocks(topic.content);
  const points = blocks.filter(
    (block): block is GrammarPointBlock => block.kind === 'grammar_point',
  );
  // Bài khoá: dialogues and narrative text, kept in content order.
  const passage = blocks.filter(
    (block): block is KeyTextBlock =>
      block.kind === 'dialogue' || block.kind === 'text',
  );
  const isGrammar = topic.type === 'grammar';
  // Old grammar topics (text only) stay on the Ngữ pháp page (Q175).
  if ((isGrammar ? points : passage).length === 0) {
    redirect(`${lessonHref}/grammar`);
  }

  // The next unit as it will be once this one is done (as Pha C).
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
      words: [],
    },
    false,
  );
  const position = units.findIndex((unit) => unit.topicId === topic.id);
  const next = units[position + 1];
  const unit = {
    lessonId,
    topicId: topic.id,
    // Pha F: same label as the unit row (Ngữ pháp 1/2/3, Bài khoá) · lesson.
    title: `${units[position]?.title ?? (isGrammar ? 'Ngữ pháp' : 'Bài khoá')} · ${activity.lesson.title}`,
    lessonHref,
    nextHref: next && !next.locked ? unitHref(lessonId, next) : null,
  };

  return isGrammar ? (
    <GrammarUnitFlow {...unit} points={points} />
  ) : (
    <KeyTextUnitFlow
      {...unit}
      heading={topic.title}
      description={topic.subtitle}
      blocks={passage}
    />
  );
}
