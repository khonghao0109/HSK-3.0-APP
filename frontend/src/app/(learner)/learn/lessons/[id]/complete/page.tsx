import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getLessonActivity } from '@/features/learner-lesson/lesson-activity-service';
import {
  displayScore,
  nextStepAfter,
} from '@/features/learner-lesson/lesson-complete';
import { loadLearnerLesson } from '@/features/learner-lesson/lesson-page-loader';
import { getLearningPath } from '@/features/learner-path/learning-path-service';
import { ToastButton } from '@/features/learner-shell/learner-toast';
import { TOAST_COMING_SOON } from '@/features/learner-shell/learner-toast-messages';

export const metadata: Metadata = {
  title: 'Hoàn thành bài học',
};

// Pieces of mẫu 06 in order; learner.css places each by :nth-child (CSP).
const CONFETTI = [
  'c-pink',
  'c-lav',
  'c-yellow is-curl',
  'c-blue',
  'c-orange',
  'c-olive',
  'c-orange',
  'c-teal',
  'c-pink',
  'c-teal',
  'c-blue',
  'c-lav',
  'c-red',
  'c-brown',
  'c-orange',
  'c-green',
  'c-cyan',
  'c-teal',
  'c-blue',
  'c-red is-diamond',
  'c-star is-star',
];

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/**
 * Lesson complete page (M2.5d, Q58–Q61). Only a done lesson shows it; any
 * other goes back to its lesson page. No XP or achievement card (Q59).
 */
export default async function LessonCompletePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { lessonId, data } = await loadLearnerLesson(
    (await params).id,
    async (token, id) => {
      const activity = await getLessonActivity(token, id);
      const path =
        activity.progress.status === 'done'
          ? await getLearningPath(token)
          : null;
      return { activity, path };
    },
  );
  if (!data.path) redirect(`/learn/lessons/${lessonId}`);

  const score = displayScore(data.activity.progress.score);
  const scoreLabel = score === null ? 'Chưa có điểm' : `Điểm ${score}%`;
  const scoreText =
    score === null ? (
      '—'
    ) : (
      <>
        {score}
        <small>%</small>
      </>
    );
  const next = nextStepAfter(data.path, lessonId);

  return (
    <>
      <div className="done-confetti" aria-hidden="true">
        {CONFETTI.map((className, index) => (
          <i key={index} className={className} />
        ))}
      </div>

      <main className="done-main">
        <p className="done-kicker">Chúc mừng! Bạn đã hoàn thành bài học</p>
        <h1 className="done-title">{data.activity.lesson.title}</h1>

        <div className="done-medal">
          <img
            src="/images/learner/m02-medal.png"
            alt=""
            width={230}
            height={105}
          />
          <p className="done-medal__score" aria-label={scoreLabel}>
            {scoreText}
          </p>
        </div>

        <div className="done-stats">
          <section className="done-stat">
            <h2>Điểm số của bạn</h2>
            <p className="done-stat__score" aria-label={scoreLabel}>
              {scoreText}
            </p>
          </section>
        </div>

        <div className="done-actions">
          <ToastButton
            className="done-btn done-btn--light"
            message={TOAST_COMING_SOON}
          >
            <Icon name="book-open-text" />
            Ôn từ mới
          </ToastButton>
          <Link className="done-btn done-btn--primary" href={next.href}>
            {next.label}
            <Icon name="arrow-right" />
          </Link>
        </div>
      </main>
    </>
  );
}
