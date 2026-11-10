import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { getExamAttempt } from '@/features/learner-exam/exam-attempt-service';
import {
  EXAM_RESULT_CANCELLED,
  EXAM_RESULT_NO_WEAK_AREAS,
  EXAM_RESULT_NO_XP,
  EXAM_RESULT_RETRY_TEXT,
  formatExamDate,
  formatExamDuration,
  passBadgeLabel,
  passHeadline,
  progressPercent,
  questionTypeBreakdown,
  skillIcon,
  skillLabel,
  weakAreaLevelLabel,
  type QuestionTypeBreakdownItem,
} from '@/features/learner-exam/exam-result-model';
import { getExamResult } from '@/features/learner-exam/exam-result-service';
import { parseAttemptId } from '@/features/learner-exam/exam-ids';
import {
  correctAnswerText,
  firstWrongQuestion,
  learnerAnswerText,
} from '@/features/learner-exam/exam-review-model';
import { getExamReview } from '@/features/learner-exam/exam-review-service';
import { BackendRequestError, isAuthFailure } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Kết quả bài thi',
};

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/**
 * TL-172: the M4.3 result page. A server component: the result is read with the
 * learner token and rendered from the stored `Result` only. The frame mirrors
 * the exam intro (WB-10b): a web bar, a mobile navy bar, then the body.
 */
function ResultShell({
  backHref,
  children,
}: {
  backHref: string;
  children: React.ReactNode;
}) {
  return (
    <main className="ex exr">
      <header className="exr-bar w-only">
        <LearnerBackButton
          fallbackHref={backHref}
          ariaLabel="Quay lại giới thiệu đề"
        />
        <h1 className="exr-bar__title">Kết quả bài thi</h1>
        <Link className="exr-history" href="/learn/exam/history">
          <Icon name="history" />
          Lịch sử thi
        </Link>
      </header>
      <header className="exr-mbar m-only">
        <LearnerBackButton
          fallbackHref={backHref}
          ariaLabel="Quay lại giới thiệu đề"
        />
        <h1 className="exr-mbar__title">Kết quả bài thi</h1>
        <Link className="exr-mhistory" href="/learn/exam/history">
          <Icon name="history" />
          Lịch sử thi
        </Link>
      </header>
      <div className="exr-body">{children}</div>
    </main>
  );
}

/** Q167: the closed (invalidated) attempt has no result, only the intro. */
function ClosedResult({
  introHref,
}: {
  introHref: string;
}): React.ReactElement {
  return (
    <ResultShell backHref={introHref}>
      <section className="exr-card exr-notice" aria-labelledby="closed-title">
        <h2 className="exr-h2" id="closed-title">
          Không có kết quả
        </h2>
        <p className="exr-text">{EXAM_RESULT_CANCELLED}</p>
        <Link className="btn btn--outline exr-notice__cta" href={introHref}>
          Về màn giới thiệu đề
        </Link>
      </section>
    </ResultShell>
  );
}

/** Q167: the result is not available yet; reloading the page retries. */
function UnavailableResult({
  retryHref,
}: {
  retryHref: string;
}): React.ReactElement {
  return (
    <ResultShell backHref="/learn">
      <section className="exr-card exr-notice" role="alert">
        <h2 className="exr-h2">Chưa tải được kết quả</h2>
        <p className="exr-text">{EXAM_RESULT_RETRY_TEXT}</p>
        <a className="btn btn--primary exr-notice__cta" href={retryHref}>
          Thử lại
        </a>
      </section>
    </ResultShell>
  );
}

export default async function LearnerExamResultPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const attemptId = parseAttemptId((await params).attemptId);
  if (attemptId === null) notFound();

  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) redirect('/sign-in');

  let result;
  try {
    result = await getExamResult(attemptId, session.token);
  } catch (error: unknown) {
    if (isAuthFailure(error)) redirect('/sign-in');
    if (
      error instanceof BackendRequestError &&
      (error.status === 400 || error.status === 404)
    ) {
      notFound();
    }
    if (error instanceof BackendRequestError && error.status === 409) {
      if (error.code === 'EXAM_ATTEMPT_NOT_TERMINAL') {
        redirect(`/learn/exam/attempts/${String(attemptId)}`);
      }
      if (error.code === 'EXAM_ATTEMPT_CLOSED') {
        // The result error body carries no test id; the attempt read still
        // serves an invalidated attempt and names the test for the way back.
        let introHref = '/learn';
        try {
          const attempt = await getExamAttempt(attemptId, session.token);
          introHref = `/learn/exam/${String(attempt.testId)}`;
        } catch {
          // The intro link is a convenience; /learn is the safe fallback.
        }
        return <ClosedResult introHref={introHref} />;
      }
      return (
        <UnavailableResult
          retryHref={`/learn/exam/attempts/${String(attemptId)}/result`}
        />
      );
    }
    throw error;
  }

  // Q219/Q220: one review read on the result page feeds the mobile explanation
  // preview and the question-type breakdown; a failed review read must never
  // break the result itself.
  let wrongPreview: {
    orderIndex: number;
    content: string;
    chosen: string;
    correct: string;
    attemptId: number;
  } | null = null;
  let typeBreakdown: QuestionTypeBreakdownItem[] = [];
  try {
    const review = await getExamReview(attemptId, session.token);
    typeBreakdown = questionTypeBreakdown(review.questions);
    const firstWrong = firstWrongQuestion(review.questions);
    if (firstWrong !== null) {
      wrongPreview = {
        orderIndex: firstWrong.orderIndex,
        content: firstWrong.content,
        chosen: learnerAnswerText(firstWrong),
        correct: correctAnswerText(firstWrong),
        attemptId: review.attemptId,
      };
    }
  } catch {
    // The preview and breakdown are optional; the result page still renders without them.
  }

  const badge = passBadgeLabel(result.passed);
  const duration = formatExamDuration(result.startedAt, result.submittedAt);
  const examDate = formatExamDate(result.submittedAt);
  const state =
    result.passed === true
      ? 'is-pass'
      : result.passed === false
        ? 'is-fail'
        : 'is-unset';
  const passline =
    result.passScore === null
      ? null
      : `Điểm đạt từ ${String(result.passScore)}/${String(result.maxScore)}`;
  const badgeIcon = result.passed === true ? 'check' : 'x-circle';
  const timedOut = result.status === 'timed_out';

  return (
    <ResultShell backHref={`/learn/exam/${String(result.testId)}`}>
      {/* Mobile/tablet hero (MB-11): score → status → test name → time/date,
          badge block where the mockup keeps the badge image (Q165 keeps text
          next to the icon instead of colour alone, R14). */}
      <section
        className={`exr-hero exr-hero--mobile m-only${
          badge === null ? ' is-nobadge' : ''
        }`}
        aria-labelledby="result-title-mobile"
      >
        {badge !== null ? (
          <span className={`exr-hero__badge ${state}`}>
            <Icon name={badgeIcon} />
            <span>{badge}</span>
          </span>
        ) : null}
        <div className="exr-hero__body">
          <p className={`exr-score ${state}`}>
            <b>{result.score}</b>
            <span className="exr-score__unit">/{result.maxScore} điểm</span>
            {timedOut ? (
              <span className="exr-chip">
                <Icon name="clock" />
                Hết giờ · tự nộp
              </span>
            ) : null}
          </p>
          <h2 className={`exr-title ${state}`} id="result-title-mobile">
            {passHeadline(result.passed)}
          </h2>
          <p className="exr-kicker">{result.testTitle}</p>
          <p className="exr-meta">
            <span>Thời gian làm bài {duration}</span>{' '}
            <span>Ngày thi {examDate}</span>
          </p>
          {passline !== null ? (
            <p className="exr-passline">{passline}</p>
          ) : null}
        </div>
      </section>

      {/* Web hero (WB-10e): eyebrow → status → score row (badge/chip inline)
          → meta line; the badge image becomes an icon+text badge (Q165). */}
      <section
        className="exr-hero exr-hero--web w-only"
        aria-labelledby="result-title-web"
      >
        <div className="exr-hero__body">
          <p className="exr-kicker">{result.testTitle}</p>
          <h2
            className={`exr-title exr-title--web ${state}`}
            id="result-title-web"
          >
            {passHeadline(result.passed)}
          </h2>
          <p className={`exr-score exr-score--web ${state}`}>
            <b>{result.score}</b>
            <span className="exr-score__unit">/{result.maxScore} điểm</span>
            {badge !== null ? (
              <span className={`exr-badge ${state}`}>
                <Icon name={badgeIcon} />
                {badge}
              </span>
            ) : null}
            {timedOut ? (
              <span className="exr-chip">
                <Icon name="clock" />
                Hết giờ · tự nộp
              </span>
            ) : null}
          </p>
          <p className="exr-meta exr-meta--web">
            <span>Thời gian làm bài {duration}</span>{' '}
            <span aria-hidden="true">·</span> <span>Ngày thi {examDate}</span>
            {passline !== null ? (
              <>
                {' '}
                <span aria-hidden="true">·</span> <span>{passline}</span>
              </>
            ) : null}
          </p>
        </div>
      </section>

      <div className="exr-grid">
        <section
          className="exr-card exr-card--skills"
          aria-labelledby="skills-title"
        >
          <h2 className="exr-h2" id="skills-title">
            Kết quả theo kỹ năng
          </h2>
          <ul className="exr-skills">
            {result.skills.map((skill) => {
              const label = skillLabel(skill.skill);
              return (
                <li
                  className={`exr-skill exr-skill--${skill.skill}`}
                  key={skill.skill}
                >
                  <span className="exr-skill__icon" aria-hidden="true">
                    <Icon name={skillIcon(skill.skill)} />
                  </span>
                  <span className="exr-skill__name">{label}</span>
                  <span className="exr-skill__bar">
                    <progress
                      className="exr-progress"
                      value={progressPercent(skill.score, skill.maxScore)}
                      max={100}
                      aria-label={`${label}: ${String(skill.score)} trên ${String(
                        skill.maxScore,
                      )} điểm`}
                    />
                  </span>
                  <span className="exr-skill__value tabular">
                    {skill.score}/{skill.maxScore}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="exr-fine">
            Điểm kỹ năng là tổng điểm các phần của kỹ năng đó; mỗi phần tối đa
            100 điểm.
          </p>
        </section>

        {typeBreakdown.length > 0 ? (
          <section
            className="exr-card exr-card--types"
            aria-labelledby="types-title"
          >
            <h2 className="exr-h2" id="types-title">
              Kết quả theo dạng câu
            </h2>
            <ul className="exr-weak exr-types">
              {typeBreakdown.map((item) => (
                <li className="exr-weak__row" key={item.type}>
                  <span className="exr-weak__name">{item.label}</span>
                  <span className="exr-skill__value tabular">
                    {item.correct}/{item.total}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section
          className="exr-card exr-card--weak"
          aria-labelledby="weak-title"
        >
          <h2 className="exr-h2" id="weak-title">
            Điểm yếu cần cải thiện
          </h2>
          {result.weakAreas.length === 0 ? (
            <p className="exr-text">{EXAM_RESULT_NO_WEAK_AREAS}</p>
          ) : (
            <ul className="exr-weak">
              {result.weakAreas.map((area) => (
                <li className="exr-weak__row" key={area.slug}>
                  <span className="exr-weak__name">{area.name}</span>
                  <span className={`exr-level exr-level--${area.level}`}>
                    <Icon
                      name={area.level === 'weak' ? 'alert-triangle' : 'info'}
                    />
                    {weakAreaLevelLabel(area.level)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {wrongPreview !== null ? (
        <section className="exr-explain m-only" aria-labelledby="explain-title">
          <div className="exr-explain__head">
            <h2 className="exr-explain__title" id="explain-title">
              Giải thích chi tiết
            </h2>
            <Link
              className="exr-explain__all"
              href={`/learn/exam/attempts/${String(
                wrongPreview.attemptId,
              )}/review`}
            >
              Xem tất cả
            </Link>
          </div>
          <p className="exr-explain__q">
            Câu {wrongPreview.orderIndex}{' '}
            <span className="exr-explain__badge">
              <Icon name="x" />
              Sai
            </span>
          </p>
          <p className="exr-explain__content">{wrongPreview.content}</p>
          <p className="exr-explain__ans">
            Bạn chọn:{' '}
            {wrongPreview.chosen === '' ? 'Chưa trả lời' : wrongPreview.chosen}
            {wrongPreview.correct === '' ? null : (
              <> · Đáp án đúng: {wrongPreview.correct}</>
            )}
          </p>
        </section>
      ) : null}

      <div className="exr-actions">
        <Link
          className="btn btn--outline exr-review"
          href={`/learn/exam/attempts/${String(attemptId)}/review`}
        >
          <Icon name="list" />
          Xem lại bài
        </Link>
        <Link
          className="btn btn--primary exr-retry"
          href={`/learn/exam/${String(result.testId)}`}
        >
          <Icon name="rotate-cw" />
          Làm lại đề này
        </Link>
      </div>
      <p className="exr-fine">{EXAM_RESULT_NO_XP}</p>
    </ResultShell>
  );
}
