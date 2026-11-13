import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import {
  examHistoryHref,
  examHistoryPassNote,
  parseExamHistoryQuery,
  toExamHistoryRow,
  type ExamHistoryQueryState,
  type ExamHistoryRow,
} from '@/features/learner-exam/exam-history-model';
import {
  getExamHistory,
  type ExamHistoryPage,
} from '@/features/learner-exam/exam-history-service';
import { EXAM_LIST_RETRY } from '@/features/learner-exam/exam-labels';
import { levelLabel } from '@/features/learner-home/level-label';
import { LearnerWebTopbar } from '@/features/learner-shell/learner-web-topbar';
import { getPublicLevels } from '@/features/onboarding/onboarding-service';
import { isAuthFailure } from '@/lib/api/api-error';

import '../exam-list.css';
import './exam-history.css';

export const metadata: Metadata = {
  title: 'Lịch sử thi',
};

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

function StatusBadge({ row }: { row: ExamHistoryRow }) {
  return (
    <span className={`ehs-badge ehs-badge--${row.statusTone}`}>
      {row.statusLabel}
    </span>
  );
}

function TotalScore({ row }: { row: ExamHistoryRow }) {
  return (
    <>
      <b>{row.score}</b>
      {row.maxScore === null ? null : `/${row.maxScore}`}
    </>
  );
}

function HistoryTable({ rows }: { rows: readonly ExamHistoryRow[] }) {
  return (
    // Focusable so a keyboard user can scroll it when the page is zoomed.
    <div
      className="ehs-tablewrap"
      tabIndex={0}
      role="region"
      aria-label="Bảng lịch sử thi thử"
    >
      <table className="ehs-table">
        <caption className="sr-only">Lịch sử thi thử</caption>
        <thead>
          <tr>
            <th scope="col">Ngày</th>
            <th scope="col">Đề thi</th>
            <th scope="col">Điểm tổng</th>
            <th scope="col">Nghe</th>
            <th scope="col">Đọc</th>
            <th scope="col">Viết</th>
            <th scope="col">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.attemptId}>
              <td className="tabular">{row.date}</td>
              <td>
                <Link className="ehs-link" href={row.href}>
                  {row.title}
                </Link>
              </td>
              <td className="tabular">
                <TotalScore row={row} />
              </td>
              <td className="tabular">{row.listening}</td>
              <td className="tabular">{row.reading}</td>
              <td className="tabular">{row.writing}</td>
              <td>
                <StatusBadge row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryCards({ rows }: { rows: readonly ExamHistoryRow[] }) {
  return (
    <ul className="ehs-cards">
      {rows.map((row) => (
        <li key={row.attemptId}>
          <Link className="ehs-card" href={row.href}>
            <span className="ehs-card__top">
              <span className="ehs-card__title">{row.title}</span>
              <span className="ehs-card__date">{row.date}</span>
            </span>
            <span className="ehs-card__scores">
              <span className="ehs-card__score">
                <b>{row.listening}</b>
                <span>Nghe</span>
              </span>
              <span className="ehs-card__score">
                <b>{row.reading}</b>
                <span>Đọc</span>
              </span>
              <span className="ehs-card__score">
                <b>{row.writing}</b>
                <span>Viết</span>
              </span>
            </span>
            <span className="ehs-card__end">
              <span className="ehs-card__total">
                Tổng {row.score}
                {row.maxScore === null ? null : `/${row.maxScore}`}
              </span>
              <StatusBadge row={row} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="ehs-empty" data-testid="exam-history-empty" role="status">
      <Icon name="history" />
      {filtered ? (
        <>
          <strong>Chưa có lần thi nào ở cấp này</strong>
          <span>Xem tất cả các lần thi của bạn ở mọi cấp HSK.</span>
          <Link
            className="btn btn--primary"
            href={examHistoryHref({ levelCode: null, page: 1 })}
          >
            Xem tất cả
          </Link>
        </>
      ) : (
        <>
          <strong>Chưa có lần thi nào</strong>
          <span>
            Các lần thi thử của bạn sẽ được lưu tại đây kèm điểm từng phần.
          </span>
          <Link className="btn btn--primary" href="/learn/exam">
            Chọn đề thi
          </Link>
        </>
      )}
    </div>
  );
}

function ErrorState({ retryHref }: { retryHref: string }) {
  return (
    <section
      className="exl-error"
      data-testid="exam-history-error"
      role="alert"
      aria-labelledby="exam-history-error-title"
    >
      <h2 className="exl-error__title" id="exam-history-error-title">
        Chưa tải được lịch sử thi
      </h2>
      <p className="exl-error__text">
        Không kết nối được máy chủ. Kiểm tra kết nối rồi thử lại.
      </p>
      <Link className="btn btn--primary exl-error__cta" href={retryHref}>
        {EXAM_LIST_RETRY}
      </Link>
    </section>
  );
}

function Pagination({
  state,
  meta,
}: {
  state: ExamHistoryQueryState;
  meta: ExamHistoryPage['meta'];
}) {
  if (meta.totalPages <= 1) return null;
  return (
    <nav className="exl-pager" aria-label="Phân trang lịch sử thi">
      {meta.page > 1 ? (
        <Link
          className="exl-pager__link"
          href={examHistoryHref({ ...state, page: meta.page - 1 })}
          aria-label="Trang trước"
        >
          <Icon name="chevron-left" />
          Trang trước
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      <span className="exl-pager__status">
        Trang {meta.page}/{meta.totalPages}
      </span>
      {meta.page < meta.totalPages ? (
        <Link
          className="exl-pager__link"
          href={examHistoryHref({ ...state, page: meta.page + 1 })}
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

function HistoryShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LearnerWebTopbar />
      <header className="exl-mbar m-only">
        <Link
          className="icon-btn"
          href="/learn/exam"
          aria-label="Quay lại danh sách đề thi"
        >
          <Icon name="arrow-left" />
        </Link>
        <h1 className="exl-mbar__title">Lịch sử thi</h1>
        <span aria-hidden="true" />
      </header>
      <main className="exl ehs">
        <header className="w-pagehead w-only">
          <div>
            <h1 className="w-h1">Lịch sử thi</h1>
            <p className="w-lead">
              Điểm từng lần thi thử, kèm điểm Nghe – Đọc – Viết để so sánh tiến
              bộ.
            </p>
          </div>
          <Link className="btn btn--primary" href="/learn/exam">
            <Icon name="trophy" />
            Chọn đề thi
          </Link>
        </header>
        {children}
      </main>
    </>
  );
}

/**
 * Lịch sử thi (M4.5 B3, WB-10f + mobile). Server component: token chỉ ở server,
 * bộ lọc và phân trang là `<Link>` theo `searchParams`.
 */
export default async function LearnerExamHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) redirect('/sign-in');
  const token = session.token;

  const raw = parseExamHistoryQuery(await searchParams);

  let levels: Awaited<ReturnType<typeof getPublicLevels>>;
  try {
    levels = await getPublicLevels(token);
  } catch (error: unknown) {
    if (isAuthFailure(error)) redirect('/sign-in');
    return (
      <HistoryShell>
        <ErrorState retryHref={examHistoryHref(raw)} />
      </HistoryShell>
    );
  }

  const state: ExamHistoryQueryState = {
    levelCode: levels.some((level) => level.code === raw.levelCode)
      ? raw.levelCode
      : null,
    page: raw.page,
  };

  let history: ExamHistoryPage;
  try {
    history = await getExamHistory(state, token);
  } catch (error: unknown) {
    if (isAuthFailure(error)) redirect('/sign-in');
    return (
      <HistoryShell>
        <ErrorState retryHref={examHistoryHref(state)} />
      </HistoryShell>
    );
  }

  if (history.data.length === 0 && state.page > 1) {
    redirect(examHistoryHref({ ...state, page: 1 }));
  }

  const rows = history.data.map(toExamHistoryRow);
  const note = examHistoryPassNote(history.data, history.meta.total);
  const count = `${String(history.meta.total)} lần thi`;

  return (
    <HistoryShell>
      <section
        className="ehs-panel"
        aria-labelledby="exam-history-title"
        data-testid="exam-history"
      >
        <h2 className="w-h3 ehs-title" id="exam-history-title">
          Các lần thi của bạn
        </h2>
        <div className="ehs-toolbar">
          <div
            className="exl-chips exl-chips--levels ehs-chips"
            role="group"
            aria-label="Lọc lịch sử thi theo cấp HSK"
          >
            <Link
              className="exl-chip"
              href={examHistoryHref({ levelCode: null, page: 1 })}
              aria-current={state.levelCode === null ? 'true' : undefined}
            >
              Tất cả
            </Link>
            {levels.map((level) => (
              <Link
                key={level.code}
                className="exl-chip"
                href={examHistoryHref({ levelCode: level.code, page: 1 })}
                aria-current={
                  level.code === state.levelCode ? 'true' : undefined
                }
              >
                {levelLabel(level.code)}
              </Link>
            ))}
          </div>
          <p className="ehs-count" data-testid="exam-history-count">
            <b>{history.meta.total}</b> lần thi
          </p>
        </div>
        <h2 className="ehs-mcount">{count}</h2>

        {rows.length === 0 ? (
          <EmptyState filtered={state.levelCode !== null} />
        ) : (
          <>
            <HistoryTable rows={rows} />
            <HistoryCards rows={rows} />
          </>
        )}

        <Pagination state={state} meta={history.meta} />
      </section>
      {note === null ? null : (
        <p className="ehs-note" data-testid="exam-history-note">
          <Icon name="info" />
          {note}
        </p>
      )}
    </HistoryShell>
  );
}
