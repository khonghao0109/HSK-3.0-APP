import type { CSSProperties } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';
import {
  displayPinyin,
  firstVietnamese,
  NO_VIETNAMESE,
} from '@/features/learner-dictionary/dictionary-display';
import { levelLabel } from '@/features/learner-home/level-label';
import { LessonImage } from '@/features/learner-lesson/lesson-image';
import { LearnerWebTopbar } from '@/features/learner-shell/learner-web-topbar';

import {
  getLessonTopicActivity,
  getLessonWords,
} from './lesson-activity-service';
import { loadLearnerLesson } from './lesson-page-loader';
import type { LessonWords } from './lesson-topic-contract';
import { DialogueLines, GrammarPointBody } from './topic-blocks-view';
import { TopicDoneButton } from './topic-done-button';
import {
  type LessonTopicKind,
  topicBlocks,
  topicsForPage,
} from './topic-content';

const PAGE_TITLE: Record<LessonTopicKind, string> = {
  vocabulary: 'Từ vựng',
  grammar: 'Ngữ pháp',
};

/**
 * M2.5f (Q175): the Từ vựng / Ngữ pháp page of a lesson renders the public
 * topics' blocks (`text`, `vocabulary_list`; Pha D: `grammar_point`,
 * `dialogue`). A locked lesson goes back to
 * the lesson page (Q40), like the player.
 */
export async function LessonTopicsView({
  rawId,
  page,
}: {
  rawId: string;
  page: LessonTopicKind;
}) {
  const { lessonId, data } = await loadLearnerLesson(rawId, (token, id) =>
    Promise.all([getLessonTopicActivity(token, id), getLessonWords(token, id)]),
  );
  const [activity, lessonWords] = data;
  const lessonHref = `/learn/lessons/${lessonId}`;
  if (activity.state === 'locked') redirect(lessonHref);

  const topics = topicsForPage(activity.topics, page);
  const title = PAGE_TITLE[page];

  return (
    <>
      <LearnerWebTopbar />
      <header className="m02-head m02-bar m-only">
        <LearnerBackButton
          fallbackHref={lessonHref}
          ariaLabel="Quay lại bài học"
        />
        <p className="m02-bar__title">{title}</p>
      </header>

      <main className="m02-sheet lesson-topics">
        <nav className="w-crumbs w-only" aria-label="Vị trí">
          <Link href="/learn/path">Lộ trình học</Link>
          <Icon name="chevron-right" className="icon--sm" />
          <Link href="/learn/path">{levelLabel(activity.level.code)}</Link>
          <Icon name="chevron-right" className="icon--sm" />
          <Link href={lessonHref}>{activity.lesson.title}</Link>
          <Icon name="chevron-right" className="icon--sm" />
          <span aria-current="page">{title}</span>
        </nav>
        <h1 className="lesson-topics__title">{`${title} · ${activity.lesson.title}`}</h1>

        {topics.length === 0 && (
          <p className="lesson-topics__empty">
            Bài này chưa có nội dung {title.toLowerCase()}.
          </p>
        )}

        {topics.map((topic) => (
          <section
            key={topic.id}
            className="topic-card"
            aria-labelledby={`topic-${topic.id}`}
          >
            <h2 className="topic-card__title" id={`topic-${topic.id}`}>
              {topic.title}
            </h2>
            {topic.subtitle && (
              <p className="topic-card__sub">{topic.subtitle}</p>
            )}
            {topicBlocks(topic.content).map((block, index) => {
              switch (block.kind) {
                case 'text':
                  return (
                    <p key={index} className="topic-card__text">
                      {block.value}
                    </p>
                  );
                case 'vocabulary_list':
                  return <WordList key={index} words={lessonWords.words} />;
                // Pha D (TL 6): the new blocks, read-only, to review.
                case 'grammar_point':
                  return (
                    <div key={index} className="topic-card__block">
                      <GrammarPointBody
                        block={block}
                        headingId={`topic-${topic.id}-gp-${index}`}
                        headingLevel="h3"
                      />
                    </div>
                  );
                case 'dialogue':
                  return (
                    <div key={index} className="topic-card__block">
                      <DialogueLines lines={block.lines} />
                    </div>
                  );
              }
            })}
            <TopicDoneButton
              topicId={topic.id}
              lessonId={lessonId}
              done={topic.progress.status === 'done'}
            />
          </section>
        ))}

        <div className="lesson-topics__pager">
          <Link className="btn btn--outline" href={lessonHref}>
            Về bài học
          </Link>
          <Link className="btn btn--primary" href={`${lessonHref}/practice`}>
            Luyện tập
            <Icon name="arrow-right" />
          </Link>
        </div>
      </main>
    </>
  );
}

export function WordList({ words }: { words: LessonWords['words'] }) {
  if (words.length === 0) return null;
  return (
    <ul className="topic-words" aria-label={`${words.length} từ trong bài`}>
      {words.map((word) => (
        <li key={word.id} className="topic-word">
          <Link
            className="topic-word__link"
            href={`/learn/dictionary/${word.id}`}
          >
            {/* Q355: every card has the same square tile, so rows line up:
                the word's image, or the word itself in large type. */}
            {word.image ? (
              <>
                <LessonImage
                  className="topic-word__img"
                  mediaId={word.image.id}
                  altText={word.image.altText}
                />
                <span className="topic-word__hz" lang="zh-Hans">
                  {word.hanzi}
                </span>
              </>
            ) : (
              <span
                className="topic-word__tile"
                lang="zh-Hans"
                style={{ '--hz-len': [...word.hanzi].length } as CSSProperties}
              >
                {word.hanzi}
              </span>
            )}
            <span className="topic-word__py">{displayPinyin(word)}</span>
            <span className="topic-word__vi">
              {firstVietnamese(word.meanings) ?? NO_VIETNAMESE}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
