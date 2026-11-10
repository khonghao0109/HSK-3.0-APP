import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import {
  EXAM_LIST_EMPTY_ACTION,
  EXAM_LIST_EMPTY_TEXT,
  EXAM_LIST_EMPTY_TITLE,
  EXAM_LIST_ERROR_TEXT,
  EXAM_LIST_ERROR_TITLE,
  EXAM_LIST_NO_SCORE,
  EXAM_LIST_NO_SCORE_HISTORY,
  EXAM_LIST_RETRY,
  EXAM_LIST_SORT_LABELS,
  EXAM_LIST_STATUS_HINTS,
  EXAM_LIST_STATUS_LABELS,
  EXAM_SKILL_ICONS,
  EXAM_SKILL_LABELS,
} from '@/features/learner-exam/exam-labels';
import {
  EXAM_LIST_FACET_LIMIT,
  EXAM_LIST_PAGE_LIMIT,
  EXAM_LIST_SKILL_VALUES,
  EXAM_LIST_SORT_VALUES,
  examListHref,
  parseExamListQuery,
  type ExamListQueryState,
  type ExamListSkill,
} from '@/features/learner-exam/exam-list-query';
import {
  getExamTestList,
  type ExamListPage,
  type ExamTestListItem,
} from '@/features/learner-exam/exam-list-service';
import { levelLabel } from '@/features/learner-home/level-label';
import { ToastButton } from '@/features/learner-shell/learner-toast';
import { LearnerWebTopbar } from '@/features/learner-shell/learner-web-topbar';
import {
  getCurrentGoal,
  getPublicLevels,
} from '@/features/onboarding/onboarding-service';
import { isAuthFailure } from '@/lib/api/api-error';

import './exam-list.css';

export const metadata: Metadata = {
  title: 'Thi thử HSK',
};

/** Q210: the skill chip order of the mockups (Nghe · Đọc · Viết · Nói). */
const SKILL_CHIP_ORDER: readonly ExamListSkill[] = EXAM_LIST_SKILL_VALUES;

type LevelOption = { code: string };

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** Q209: the learner's current level, already stored server-side (goal). */
async function readLearnerLevelCode(token: string): Promise<string | null> {
  try {
    return (await getCurrentGoal(token))?.targetLevel.code ?? null;
  } catch {
    // The list only needs a default chip: a missing goal (or a failing goal
    // read) must not block a learner who has not onboarded yet (Q119).
    return null;
  }
}

function defaultLevelCode(
  levels: readonly LevelOption[],
  learnerLevelCode: string | null,
): string {
  if (
    learnerLevelCode !== null &&
    levels.some((level) => level.code === learnerLevelCode)
  ) {
    return learnerLevelCode;
  }
  return levels[0]?.code ?? 'HSK1';
}

function effectiveState(
  raw: ReturnType<typeof parseExamListQuery>,
  levelCode: string,
): ExamListQueryState {
  return {
    levelCode,
    skill: raw.skill,
    sort: raw.sort,
    page: raw.page,
  };
}

/** Q210: skills with at least one visible test at the selected level. */
function availableSkills(items: readonly ExamTestListItem[]): ExamListSkill[] {
  return SKILL_CHIP_ORDER.filter((skill) =>
    items.some((item) => item.skills.includes(skill)),
  );
}

function skillsLabel(item: ExamTestListItem): string {
  const labels = item.skills.map((skill) => EXAM_SKILL_LABELS[skill]);
  return labels.length > 0 ? labels.join(', ') : 'Đề tổng hợp';
}

/**
 * Q212 + mockup links: an active attempt opens the take screen, a finished one
 * opens the result page (`exams.html:99,105,111,123`; `mobile/exams.html:83`)
 * even when `resultAvailable` is false — that page grades lazily (Q214); only a
 * test with no attempt at all opens the intro.
 */
function cardHref(item: ExamTestListItem): string {
  if (item.status === 'in_progress' && item.activeAttempt !== null) {
    return `/learn/exam/attempts/${String(item.activeAttempt.attemptId)}`;
  }
  if (item.status === 'done' && item.latestAttempt !== null) {
    return `/learn/exam/attempts/${String(item.latestAttempt.attemptId)}/result`;
  }
  return `/learn/exam/${String(item.testId)}`;
}

function cardAriaLabel(item: ExamTestListItem): string {
  const parts = [
    item.title,
    skillsLabel(item),
    `${String(item.questionCount)} câu`,
    `${String(item.duration)} phút`,
    EXAM_LIST_STATUS_LABELS[item.status],
  ];
  if (item.latestAttempt?.resultAvailable === true) {
    parts.push(
      `${String(item.latestAttempt.score)} trên ${String(item.latestAttempt.maxScore)} điểm`,
    );
  }
  return parts.join(', ');
}

/**
 * Q226: the trophy toast of the mobile bar. The best finished score of the
 * tests visible at the selected level (the facet read) wins; a level with no
 * scored attempt reads "Chưa có điểm thi thử".
 */
function bestScoreToast(items: readonly ExamTestListItem[]): string {
  let best: { score: number; maxScore: number | null; title: string } | null =
    null;
  for (const item of items) {
    const attempt = item.latestAttempt;
    if (
      attempt === null ||
      !attempt.resultAvailable ||
      attempt.score === null
    ) {
      continue;
    }
    if (best === null || attempt.score > best.score) {
      best = {
        score: attempt.score,
        maxScore: attempt.maxScore,
        title: item.title,
      };
    }
  }
  if (best === null) return EXAM_LIST_NO_SCORE_HISTORY;
  const total =
    best.maxScore === null
      ? String(best.score)
      : `${best.score}/${best.maxScore}`;
  return `Điểm cao nhất: ${total} — ${best.title}`;
}

function ExamCard({ item }: { item: ExamTestListItem }) {
  const firstSkill = item.skills[0];
  const score =
    item.latestAttempt !== null && item.latestAttempt.resultAvailable
      ? item.latestAttempt.score
      : null;
  const maxScore = item.latestAttempt?.maxScore ?? null;
  const hint = EXAM_LIST_STATUS_HINTS[item.status];

  return (
    <li className="exl-grid__cell">
      <Link
        className={`exl-item exl-item--${item.status}`}
        href={cardHref(item)}
        aria-label={cardAriaLabel(item)}
      >
        <span className="exl-item__icon" aria-hidden="true">
          <Icon
            name={
              firstSkill === undefined ? 'list' : EXAM_SKILL_ICONS[firstSkill]
            }
          />
        </span>
        <span className="exl-item__main">
          <b className="exl-item__title">{item.title}</b>
          <span className="exl-item__meta">
            <span>{skillsLabel(item)}</span>
            <span>{item.questionCount} câu</span>
            <span>{item.duration} phút</span>
          </span>
        </span>
        <span className="exl-item__end">
          <span className={`exl-badge exl-badge--${item.status}`}>
            <Icon
              name={
                item.status === 'done'
                  ? 'check-circle'
                  : item.status === 'in_progress'
                    ? 'clock'
                    : 'circle'
              }
            />
            {EXAM_LIST_STATUS_LABELS[item.status]}
          </span>
          {score !== null ? (
            <span className="exl-item__score tabular">
              {score}
              {maxScore !== null ? <small>/{maxScore}</small> : null}
            </span>
          ) : hint !== null ? (
            <span className={`exl-item__hint exl-item__hint--${item.status}`}>
              {hint}
            </span>
          ) : (
            <span className="exl-item__hint">{EXAM_LIST_NO_SCORE}</span>
          )}
        </span>
        <svg className="icon exl-item__chev" aria-hidden="true">
          <use href="#i-chevron-right" />
        </svg>
      </Link>
    </li>
  );
}

function SortMenu({ state }: { state: ExamListQueryState }) {
  return (
    <details className="exl-sort">
      <summary
        className="exl-sort__summary"
        aria-label={`Sắp xếp theo ${EXAM_LIST_SORT_LABELS[state.sort]}`}
      >
        <span className="exl-sort__label">Sắp xếp:</span>
        <span className="exl-sort__value">
          {EXAM_LIST_SORT_LABELS[state.sort]}
        </span>
        <Icon name="chevron-down" />
      </summary>
      <ul className="exl-sort__menu">
        {EXAM_LIST_SORT_VALUES.map((sort) => (
          <li key={sort}>
            <Link
              className="exl-sort__option"
              href={examListHref(state, { sort })}
              aria-current={sort === state.sort ? 'true' : undefined}
            >
              {EXAM_LIST_SORT_LABELS[sort]}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

function EmptyState({ state }: { state: ExamListQueryState }) {
  return (
    <div className="exl-empty" data-testid="exam-list-empty" role="status">
      <span className="exl-empty__icon" aria-hidden="true">
        <Icon name="trophy" />
      </span>
      <strong>{EXAM_LIST_EMPTY_TITLE}</strong>
      <span>{EXAM_LIST_EMPTY_TEXT}</span>
      <Link
        className="btn btn--primary exl-empty__cta"
        href={examListHref({
          ...state,
          levelCode: null,
          skill: null,
          page: 1,
        })}
      >
        {EXAM_LIST_EMPTY_ACTION}
      </Link>
    </div>
  );
}

function ErrorState({ retryHref }: { retryHref: string }) {
  return (
    <section
      className="exl-error"
      data-testid="exam-list-error"
      role="alert"
      aria-labelledby="exam-list-error-title"
    >
      <h2 className="exl-error__title" id="exam-list-error-title">
        {EXAM_LIST_ERROR_TITLE}
      </h2>
      <p className="exl-error__text">{EXAM_LIST_ERROR_TEXT}</p>
      {/* Link re-runs the server component (and therefore the failing backend
          read); a client `reset` would not refetch it. */}
      <Link className="btn btn--primary exl-error__cta" href={retryHref}>
        {EXAM_LIST_RETRY}
      </Link>
    </section>
  );
}

function Pagination({
  state,
  page,
}: {
  state: ExamListQueryState;
  page: ExamListPage['meta'];
}) {
  if (page.totalPages <= 1) return null;
  return (
    <nav className="exl-pager" aria-label="Phân trang danh sách đề">
      {page.page > 1 ? (
        <Link
          className="exl-pager__link"
          href={examListHref(state, { page: page.page - 1 })}
          aria-label="Trang trước"
        >
          <Icon name="chevron-left" />
          Trang trước
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      <span className="exl-pager__status">
        Trang {page.page}/{page.totalPages}
      </span>
      {page.page < page.totalPages ? (
        <Link
          className="exl-pager__link"
          href={examListHref(state, { page: page.page + 1 })}
          aria-label="Trang sau"
        >
          Trang sau
          <Icon name="chevron-right" />
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}

/**
 * Danh sách đề thi thử (M4.5 B1, WB-10a + MB-10). Q119: chỉ cần đăng nhập;
 * cấp của học viên chỉ là filter mặc định của chip, không lọc quyền xem đề.
 * Mọi filter/sort là `<Link>` theo `searchParams` (không cần client island).
 */
export default async function LearnerExamListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) redirect('/sign-in');
  const token = session.token;

  const raw = parseExamListQuery(await searchParams);
  // The retry link keeps exactly what the URL asked for, so a transient
  // backend failure does not silently reset the learner's filters.
  const retryHref = examListHref({
    levelCode: raw.levelCode,
    skill: raw.skill,
    sort: raw.sort,
    page: raw.page,
  });

  let levels: Awaited<ReturnType<typeof getPublicLevels>>;
  let learnerLevelCode: string | null;
  try {
    [levels, learnerLevelCode] = await Promise.all([
      getPublicLevels(token),
      readLearnerLevelCode(token),
    ]);
  } catch (error: unknown) {
    if (isAuthFailure(error)) redirect('/sign-in');
    return (
      <ExamListShell trophyMessage={EXAM_LIST_NO_SCORE_HISTORY}>
        <ErrorState retryHref={retryHref} />
      </ExamListShell>
    );
  }

  const fallback = defaultLevelCode(levels, learnerLevelCode);
  const levelCode =
    raw.levelCode !== null &&
    levels.some((level) => level.code === raw.levelCode)
      ? raw.levelCode
      : fallback;
  const state = effectiveState(raw, levelCode);

  let facet: ExamListPage;
  let page: ExamListPage;
  try {
    // One extra fixed read for the skill chips: Q210 only shows a chip when
    // at least one visible test at the level carries that skill.
    // shortcut: facet read capped at EXAM_LIST_FACET_LIMIT (100) visible tests
    // (the GET /exam/tests limit ceiling), page 1 only; upgrade to a skills
    // facet field/endpoint when one level can publish more than 100 tests.
    [facet, page] = await Promise.all([
      getExamTestList(
        {
          levelCode,
          sort: state.sort,
          page: 1,
          limit: EXAM_LIST_FACET_LIMIT,
        },
        token,
      ),
      getExamTestList(
        {
          levelCode,
          ...(state.skill === null ? {} : { skill: state.skill }),
          sort: state.sort,
          page: state.page,
          limit: EXAM_LIST_PAGE_LIMIT,
        },
        token,
      ),
    ]);
  } catch (error: unknown) {
    if (isAuthFailure(error)) redirect('/sign-in');
    return (
      <ExamListShell trophyMessage={EXAM_LIST_NO_SCORE_HISTORY}>
        <ErrorState retryHref={retryHref} />
      </ExamListShell>
    );
  }

  const skillChips = availableSkills(facet.data);
  // Q226: the trophy toast is computed from the same facet read, so it covers
  // every visible test at the selected level.
  const trophyMessage = bestScoreToast(facet.data);
  const items = page.data;
  const noResults = items.length === 0;
  const chipBase: ExamListQueryState = {
    ...state,
    skill: null,
    page: 1,
  };

  return (
    <ExamListShell trophyMessage={trophyMessage}>
      <header className="w-pagehead w-only">
        <div>
          <h1 className="w-h1">Thi thử HSK</h1>
          <p className="w-lead">
            Làm đề theo từng kỹ năng, xem điểm và lịch sử các lần thi.
          </p>
        </div>
        <Link className="btn btn--outline" href="/learn/exam/history">
          <Icon name="history" />
          Lịch sử thi
        </Link>
      </header>

      <section
        className="exl-panel"
        aria-labelledby="exam-list-title"
        data-testid="exam-list"
      >
        <div className="exl-panel__head">
          <h2 className="exl-panel__title" id="exam-list-title">
            Danh sách đề thi
          </h2>
          <SortMenu state={state} />
        </div>

        <div className="exl-filters">
          <div className="exl-filterrow">
            <p className="exl-filterlabel" id="exam-level-label">
              <span className="exl-label-web">Cấp độ</span>
              <span className="exl-label-mobile">Chọn cấp độ HSK</span>
            </p>
            <div
              className="exl-chips exl-chips--levels"
              role="group"
              aria-labelledby="exam-level-label"
            >
              {levels.map((level) => (
                <Link
                  key={level.code}
                  className="exl-chip"
                  href={examListHref(state, {
                    levelCode: level.code,
                    skill: state.skill,
                    page: 1,
                  })}
                  aria-current={
                    level.code === state.levelCode ? 'true' : undefined
                  }
                >
                  {levelLabel(level.code)}
                </Link>
              ))}
            </div>
          </div>

          <div className="exl-filterrow">
            <p className="exl-filterlabel" id="exam-skill-label">
              <span className="exl-label-web">Kỹ năng</span>
              <span className="exl-label-mobile">Chọn kỹ năng</span>
            </p>
            <div
              className="exl-chips exl-chips--skills"
              role="group"
              aria-labelledby="exam-skill-label"
            >
              <Link
                className="exl-chip"
                href={examListHref(chipBase)}
                aria-current={state.skill === null ? 'true' : undefined}
              >
                Tất cả
              </Link>
              {skillChips.map((skill) => (
                <Link
                  key={skill}
                  className="exl-chip"
                  href={examListHref(state, { skill, page: 1 })}
                  aria-current={state.skill === skill ? 'true' : undefined}
                >
                  <Icon name={EXAM_SKILL_ICONS[skill]} />
                  {EXAM_SKILL_LABELS[skill]}
                </Link>
              ))}
            </div>
            <p className="exl-count" data-testid="exam-list-count">
              <b>{page.meta.total}</b> đề phù hợp
            </p>
          </div>
        </div>

        {noResults ? (
          <EmptyState state={state} />
        ) : (
          <ul className="exl-grid" aria-labelledby="exam-list-title">
            {items.map((item) => (
              <ExamCard key={item.testId} item={item} />
            ))}
          </ul>
        )}

        <Pagination state={state} page={page.meta} />
      </section>
    </ExamListShell>
  );
}

/**
 * Page frame shared by the list, the empty state and the error state: mobile
 * navy bar (mẫu `exams.html` .m04-bar) + web page wrapper. The trophy button
 * of the mockup has no achievements API yet; Q226 turns it into a toast with
 * the best finished score at the selected level instead of a dead link.
 */
function ExamListShell({
  children,
  trophyMessage,
}: {
  children: React.ReactNode;
  /** Q226: text of the mobile trophy toast (mockup keeps a trophy button). */
  trophyMessage: string;
}) {
  return (
    <>
      {/* The `.w-app` frame needs its top bar (the same one the other web
          pages render); without it the `.app` column keeps the mobile width. */}
      <LearnerWebTopbar />
      <header className="exl-mbar m-only">
        <Link
          className="icon-btn"
          href="/learn"
          aria-label="Quay lại Trang chủ"
        >
          <svg className="icon" aria-hidden="true">
            <use href="#i-chevron-left" />
          </svg>
        </Link>
        <h1 className="exl-mbar__title">Thi thử</h1>
        <ToastButton
          className="exl-trophy"
          aria-label="Thành tích thi thử"
          message={trophyMessage}
        >
          <Icon name="trophy" />
        </ToastButton>
      </header>
      <main className="exl">{children}</main>
    </>
  );
}
