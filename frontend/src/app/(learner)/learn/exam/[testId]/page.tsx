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
import { ToastButton } from '@/features/learner-shell/learner-toast';
import { TOAST_COMING_SOON } from '@/features/learner-shell/learner-toast-messages';
import { BackendRequestError, isAuthFailure } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Giới thiệu đề',
};

const EXPIRY_TIME = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
});

function expiryTime(iso: string): string {
  return EXPIRY_TIME.format(new Date(iso));
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

  return (
    <main className="ex exi">
      <header className="exi-bar w-only">
        <LearnerBackButton fallbackHref="/learn" ariaLabel="Quay lại" />
        <h1 className="exi-bar__title">Giới thiệu đề</h1>
        <span className="exi-bar__level">{level}</span>
      </header>
      <header className="exi-mbar m-only">
        <LearnerBackButton fallbackHref="/learn" ariaLabel="Quay lại" />
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
                {activeAttempt.questionCount} câu · hết giờ lúc{' '}
                {expiryTime(activeAttempt.expiresAt)}
              </p>
            </div>
            <ToastButton
              className="btn btn--outline exi-resume__cta"
              message={TOAST_COMING_SOON}
            >
              Làm tiếp
              <svg className="icon" aria-hidden="true">
                <use href="#i-arrow-right" />
              </svg>
            </ToastButton>
          </section>
        ) : null}

        <div className="exi-actions" data-testid="exam-actions">
          {activeAttempt === null ? (
            <ExamStartButton testId={intro.id} />
          ) : null}
          <Link className="btn btn--outline exi-actions__back" href="/learn">
            Quay lại
          </Link>
        </div>
      </div>
    </main>
  );
}
