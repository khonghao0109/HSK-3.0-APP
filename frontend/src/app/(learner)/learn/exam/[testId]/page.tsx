import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import {
  EXAM_INTRO_RULES,
  EXAM_SKILL_LABELS,
} from '@/features/learner-exam/exam-labels';
import { ExamStartButton } from '@/features/learner-exam/exam-start-button';
import {
  getExamIntro,
  type ExamTestIntro,
} from '@/features/learner-exam/exam-intro-service';
import { levelLabel } from '@/features/learner-home/level-label';
import { parseLessonId } from '@/features/learner-lesson/lesson-sections';
import { BackendRequestError, isAuthFailure } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Giới thiệu đề',
};

/**
 * The intro payload has no `serverNow` (Q122 fixes the deadline, not the wire
 * shape), and the JSX must not call the clock inline (react-hooks purity). A
 * server component renders once per request, so this helper reads the request
 * time in the data layer and the JSX stays a pure function of its inputs.
 */
async function requestNowMs(): Promise<number> {
  return Date.now();
}

/**
 * M4.5 B1: the resume card counts down on the server (`expiresAt − now`), the
 * same `mm:ss` / `h:mm:ss` convention as the result page (Q168). Q122 defines
 * the deadline but not its display, so the old "hết giờ lúc HH:mm" line is
 * replaced instead of kept.
 */
export function remainingLabel(expiresAtIso: string, nowMs: number): string {
  const totalSeconds = Math.max(
    0,
    Math.floor((new Date(expiresAtIso).getTime() - nowMs) / 1000),
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${two(minutes)}:${two(seconds)}`
    : `${two(minutes)}:${two(seconds)}`;
}

type IconName = 'list' | 'clock' | 'layers' | 'check' | 'rotate-cw';

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon icon--sm" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/**
 * Exam intro (M4.2a, Q122/MB-10). Q119 only asks the learner to be signed in,
 * so this page deliberately does not load the lesson gate: it must not send a
 * learner without onboarding to `/onboarding`.
 */
export default async function LearnerExamIntroPage({
  params,
}: {
  params: Promise<{ testId: string }>;
}) {
  // Same positive-int rule as the lesson id; the segment is a test id here.
  const testId = parseLessonId((await params).testId);
  if (testId === null) notFound();

  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) redirect('/sign-in');

  let intro: ExamTestIntro;
  try {
    intro = await getExamIntro(testId, session.token);
  } catch (error: unknown) {
    if (isAuthFailure(error)) redirect('/sign-in');
    if (
      error instanceof BackendRequestError &&
      (error.status === 400 || error.status === 404)
    ) {
      notFound();
    }
    throw error;
  }

  const level = levelLabel(intro.levelCode);
  const activeAttempt = intro.activeAttempt;
  const resumeRemaining =
    activeAttempt === null
      ? null
      : remainingLabel(activeAttempt.expiresAt, await requestNowMs());

  return (
    <main className="ex exi">
      <header className="exi-bar w-only">
        <LearnerBackButton fallbackHref="/learn/exam" ariaLabel="Quay lại" />
        <h1 className="exi-bar__title">Giới thiệu đề</h1>
        <span className="exi-bar__level">{level}</span>
      </header>
      <header className="exi-mbar m-only">
        <LearnerBackButton fallbackHref="/learn/exam" ariaLabel="Quay lại" />
        <h1 className="exi-mbar__title">Giới thiệu đề</h1>
        <span aria-hidden="true" className="exi-mbar__spacer" />
      </header>

      <div className="exi-body">
        <section className="exi-hero" aria-labelledby="exam-title">
          <p className="exi-kicker">{level}</p>
          <h2 className="exi-title" id="exam-title">
            {intro.title}
          </h2>
          {intro.instruction ? (
            <p className="exi-instruction">{intro.instruction}</p>
          ) : null}
          <p className="exi-meta">
            <span>
              <Icon name="list" />
              {intro.questionCount} câu
            </span>
            <span>
              <Icon name="clock" />
              {intro.durationMinutes} phút
            </span>
            <span>
              <Icon name="layers" />
              {intro.sectionCount} phần
            </span>
          </p>
        </section>

        <section className="exi-panel" aria-labelledby="exam-parts">
          <h2 className="exi-h2" id="exam-parts">
            Cấu trúc đề
          </h2>
          <div className="exi-tablewrap w-only">
            <table className="exi-table">
              <caption className="sr-only">
                Cấu trúc {intro.sectionCount} phần của đề thi
              </caption>
              <thead>
                <tr>
                  <th scope="col">Phần</th>
                  <th scope="col">Nội dung</th>
                  <th scope="col">Số câu</th>
                  <th scope="col">Điểm</th>
                </tr>
              </thead>
              <tbody>
                {intro.sections.map((section) => (
                  <tr key={section.orderIndex}>
                    <td>
                      <b>{section.orderIndex}</b>
                    </td>
                    <td>
                      <b>{section.title}</b>
                      <small className="exi-cellnote">
                        {EXAM_SKILL_LABELS[section.skill]}
                      </small>
                    </td>
                    <td className="tabular">{section.questionCount}</td>
                    <td className="tabular">{section.maxScore}</td>
                  </tr>
                ))}
                <tr className="exi-table__total">
                  <td colSpan={2}>Tổng cộng</td>
                  <td className="tabular">{intro.questionCount}</td>
                  <td className="tabular">{intro.maxScore}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="exi-parts m-only" data-testid="exam-parts-list">
            {intro.sections.map((section) => (
              <div className="exi-part" key={section.orderIndex}>
                <span className="exi-part__no" aria-hidden="true">
                  {section.orderIndex}
                </span>
                <div>
                  <p className="exi-part__name">{section.title}</p>
                  <p className="exi-part__meta">
                    {section.questionCount} câu ·{' '}
                    {EXAM_SKILL_LABELS[section.skill]}
                  </p>
                </div>
                <span className="exi-part__score">{section.maxScore} điểm</span>
              </div>
            ))}
            <p className="exi-total">
              <span>Tổng cộng</span>
              <span>
                {intro.questionCount} câu · {intro.durationMinutes} phút
              </span>
            </p>
          </div>
          {intro.passScore !== null ? (
            <p className="exi-fine">
              Điểm đạt: {intro.passScore}/{intro.maxScore}
            </p>
          ) : null}
        </section>

        <section className="exi-panel" aria-labelledby="exam-rules">
          <h2 className="exi-h2" id="exam-rules">
            Quy định khi thi
          </h2>
          <ul className="exi-rules" aria-labelledby="exam-rules">
            {EXAM_INTRO_RULES.map((rule) => (
              <li key={rule}>
                <Icon name="check" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </section>

        {activeAttempt !== null ? (
          <section className="exi-resume" aria-labelledby="exam-resume">
            <span className="exi-resume__ico" aria-hidden="true">
              <Icon name="rotate-cw" />
            </span>
            <div className="exi-resume__text">
              <h3 className="exi-resume__title" id="exam-resume">
                Bài đang làm
              </h3>
              <p className="exi-resume__meta">
                Đã làm {activeAttempt.answeredCount}/
                {activeAttempt.questionCount} câu · còn {resumeRemaining}
              </p>
            </div>
            <Link
              className="btn btn--outline exi-resume__cta"
              href={`/learn/exam/attempts/${String(activeAttempt.id)}`}
            >
              Làm tiếp
              <svg className="icon" aria-hidden="true">
                <use href="#i-arrow-right" />
              </svg>
            </Link>
          </section>
        ) : null}

        <div className="exi-actions" data-testid="exam-actions">
          {activeAttempt === null ? (
            <ExamStartButton testId={intro.id} />
          ) : null}
          <Link
            className="btn btn--outline exi-actions__back"
            href="/learn/exam"
          >
            Quay lại
          </Link>
        </div>
      </div>
    </main>
  );
}
