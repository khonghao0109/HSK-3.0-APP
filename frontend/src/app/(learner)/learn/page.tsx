import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import {
  dailyGoalPercent,
  levelLabel,
  percentClass,
  wholePercent,
  type LearningHome,
} from '@/features/learner-home/learning-home-contract';
import { getLearningHome } from '@/features/learner-home/learning-home-service';
import { ToastButton } from '@/features/learner-shell/learner-toast';
import {
  TOAST_COMING_SOON,
  TOAST_NOTIFICATIONS,
} from '@/features/learner-shell/learner-toast-messages';
import { getCurrentGoal } from '@/features/onboarding/onboarding-service';
import { routeForOnboarding } from '@/features/onboarding/route-for-onboarding';
import { isAuthFailure } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Trang chủ',
};

/** "Khám phá" shortcuts (Q1); none of the targets has shipped yet (Q16). */
const EXPLORE = [
  { label: 'Thi thử', icon: 'trophy', tone: 'amber' },
  { label: 'Phát âm', icon: 'mic', tone: 'red' },
  { label: 'Đọc hiểu', icon: 'book-open', tone: 'jade' },
  { label: 'Tài liệu', icon: 'file-text', tone: 'blue' },
  { label: 'Trợ lý AI', icon: 'sparkles', tone: 'violet' },
  { label: 'Hội thoại', icon: 'message-circle', tone: 'jade' },
  { label: 'Nhận diện chữ', icon: 'file-stack', tone: 'blue' },
  { label: 'Hỗ trợ', icon: 'help-circle', tone: 'amber' },
] as const;

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

export default async function LearnerHomePage() {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }

  let home: LearningHome | null = null;
  let redirectTarget: string | null = null;
  let authFailed = false;

  try {
    home = await getLearningHome(session.token);
    if (home.nextStep !== 'ready') {
      const goal =
        home.nextStep === 'generate_plan'
          ? await getCurrentGoal(session.token)
          : null;
      redirectTarget = routeForOnboarding(home, goal);
    }
  } catch (error) {
    if (!isAuthFailure(error)) throw error;
    authFailed = true;
  }

  if (authFailed || !home) {
    redirect('/sign-in');
  }

  if (redirectTarget) {
    redirect(redirectTarget);
  }

  const { dailyGoal, continueLesson } = home;
  const goalPercent = dailyGoalPercent(dailyGoal);
  const lessonPercent = wholePercent(continueLesson?.completionPercent ?? 0);

  return (
    <>
      <header className="home-hero">
        <img
          className="home-hero__art"
          src="/images/learner/home-header-art.png"
          alt=""
          width={134}
          height={112}
        />
        <div className="home-hero__top">
          <Link className="home-hero__logo" href="/learn">
            Hán Lộ
          </Link>
          <ToastButton
            className="icon-btn home-hero__bell"
            aria-label="Thông báo"
            message={TOAST_NOTIFICATIONS}
          >
            <Icon name="bell" />
          </ToastButton>
        </div>
        <div className="home-hero__greet">
          <Link
            className="home-hero__avatar"
            href="/learn/profile"
            aria-label="Hồ sơ"
          >
            <Icon name="user" />
          </Link>
          <div>
            <h1>
              {home.greetingName ? `Chào, ${home.greetingName}` : 'Chào bạn'}
            </h1>
            <p>Hôm nay cùng tiến bộ nhé!</p>
          </div>
        </div>
      </header>

      <main className="home-body">
        <div className="home-stats">
          <section className="home-stat" aria-labelledby="home-goal-title">
            <h2 id="home-goal-title">Mục tiêu hôm nay</h2>
            <p className="sr-only">
              {dailyGoal
                ? `${dailyGoal.minutesToday} trên ${dailyGoal.targetMinutes} phút`
                : 'Chưa có mục tiêu'}
            </p>
            <div
              className={`home-gauge ${percentClass(goalPercent)}`}
              aria-hidden="true"
            >
              <span>
                {dailyGoal ? (
                  <b>
                    {dailyGoal.minutesToday}
                    <small>/{dailyGoal.targetMinutes}</small>
                  </b>
                ) : (
                  <b>—</b>
                )}
                <em>phút</em>
              </span>
            </div>
          </section>
          <section className="home-stat" aria-labelledby="home-streak-title">
            <h2 id="home-streak-title">Chuỗi ngày học</h2>
            <p className="sr-only">{`${home.streakDays} ngày`}</p>
            <div className="home-streak" aria-hidden="true">
              <img
                src="/images/learner/fire.png"
                alt=""
                width={40}
                height={42}
              />
              <div>
                <b>{home.streakDays}</b>
                <span>ngày</span>
              </div>
            </div>
          </section>
        </div>

        {continueLesson && (
          <>
            <h2 className="home-section">Tiếp tục học</h2>
            <ToastButton className="home-lesson" message={TOAST_COMING_SOON}>
              <span className="home-lesson__art" aria-hidden="true">
                <Icon name="book-open" />
              </span>
              <span className="grow">
                <span className="home-lesson__title">
                  {continueLesson.title}
                </span>
                <span className="home-lesson__meta">
                  {levelLabel(continueLesson.levelCode)} • Bài{' '}
                  {continueLesson.position}
                </span>
                <span className="home-lesson__bar">
                  <span className="progress" aria-hidden="true">
                    <span className={percentClass(lessonPercent)} />
                  </span>
                  {lessonPercent}%
                </span>
              </span>
              <Icon name="chevron-right" />
            </ToastButton>
          </>
        )}

        <h2 className="home-section" id="explore-title">
          Khám phá
        </h2>
        <ul className="home-explore" aria-labelledby="explore-title">
          {EXPLORE.map((item) => (
            <li key={item.label}>
              <ToastButton message={TOAST_COMING_SOON}>
                <span
                  className={`home-explore__icon home-explore__icon--${item.tone}`}
                  aria-hidden="true"
                >
                  <Icon name={item.icon} />
                </span>
                {item.label}
              </ToastButton>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
