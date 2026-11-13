'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  calendarWeeks,
  dayLabel,
  monthLabel,
  sessionDate,
  type ReviewOverview,
} from './review-overview-model';
import {
  createReviewTransport,
  type ReviewTransport,
} from './review-transport';

const SESSION_HREF = '/learn/review/session';

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; data: ReviewOverview };

/**
 * M3.3b (Q270): /learn/review, the due count, 7-day retention, 3/7/14-day
 * split, month calendar and the latest sessions. Read through the BFF only;
 * no streak (Q269) and no "Xem tất cả" until a history page exists.
 */
export function ReviewOverviewView({
  transport: given,
}: {
  transport?: ReviewTransport;
}) {
  const router = useRouter();
  const transport = useMemo(() => given ?? createReviewTransport(), [given]);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const started = useRef(false);

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' });
    const result = await transport.overview<ReviewOverview>();
    if (result.ok) return setPhase({ kind: 'ready', data: result.data });
    if (result.status === 401 || result.status === 403) {
      return router.replace('/sign-in');
    }
    setPhase({ kind: 'error' });
  }, [transport, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  const data = phase.kind === 'ready' ? phase.data : null;
  const canStart = data !== null && data.dueToday > 0;

  return (
    <>
      <header className="appbar appbar--short m-only">
        <Link className="icon-btn" href="/learn" aria-label="Quay lại">
          <Icon name="arrow-left" />
        </Link>
        <h1 className="appbar__title">Ôn tập</h1>
        <span className="appbar__end" aria-hidden="true" />
      </header>

      <main className="rvo m03-tabbed" aria-busy={phase.kind === 'loading'}>
        <div className="w-pagehead w-only">
          <div>
            <h1 className="w-h1">Ôn tập</h1>
            <p className="w-lead">
              Xem thẻ đến hạn, lịch ôn theo tháng và lịch sử các phiên ôn.
            </p>
          </div>
          {canStart ? (
            <Link className="btn w-btn w-btn--primary" href={SESSION_HREF}>
              <Icon name="play" />
              Bắt đầu ôn ngay
            </Link>
          ) : (
            <button className="btn w-btn w-btn--primary" type="button" disabled>
              <Icon name="play" />
              Bắt đầu ôn ngay
            </button>
          )}
        </div>

        {phase.kind === 'loading' && (
          <p className="rvo-state" role="status">
            Đang tải lịch ôn tập…
          </p>
        )}

        {phase.kind === 'error' && (
          <section className="rvo-state" aria-labelledby="rvo-error">
            <h2 id="rvo-error" className="rvo-state__title">
              Chưa tải được lịch ôn tập
            </h2>
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => void load()}
            >
              Thử lại
            </button>
          </section>
        )}

        {data && <OverviewBody data={data} />}
      </main>
    </>
  );
}

function OverviewBody({ data }: { data: ReviewOverview }) {
  const weeks = calendarWeeks(data.calendar);
  const first = data.calendar[0]?.date ?? '';
  const month = Number(first.slice(5, 7));
  const label = first ? monthLabel(first) : '';
  const retention = data.retention7d;

  return (
    <>
      <div className="rvo-stats">
        {data.dueToday > 0 ? (
          <Link
            className="rvo-stat rvo-stat--due"
            href={SESSION_HREF}
            aria-label={`Đến hạn hôm nay: ${String(data.dueToday)} thẻ. Bắt đầu ôn`}
          >
            <DueContent count={data.dueToday} />
            <span className="rvo-link">
              Ôn ngay
              <Icon name="chevron-right" />
            </span>
          </Link>
        ) : (
          <section
            className="rvo-stat rvo-stat--due"
            aria-label="Đến hạn hôm nay: 0 thẻ"
          >
            <DueContent count={0} />
            <span className="rvo-stat__end">
              <button className="rvo-link" type="button" disabled>
                Ôn ngay
                <Icon name="chevron-right" />
              </button>
              <span className="rvo-stat__desc">Không có thẻ đến hạn</span>
            </span>
          </section>
        )}

        <section
          className="rvo-stat rvo-stat--rate"
          aria-label={
            retention === null
              ? 'Tỷ lệ ghi nhớ: chưa có dữ liệu'
              : `Tỷ lệ ghi nhớ ${String(retention)} phần trăm`
          }
        >
          <span className="rvo-stat__ico" aria-hidden="true">
            <Icon name="check-circle" />
          </span>
          <span className="rvo-stat__text" aria-hidden="true">
            <span className="rvo-stat__label">Tỷ lệ ghi nhớ</span>
            <span className="rvo-stat__val tabular">
              {retention === null ? '—' : String(retention)}
              {retention !== null && <small>%</small>}
            </span>
          </span>
          <span
            className="rvo-ring"
            style={{ '--value': retention ?? 0 } as React.CSSProperties}
            aria-hidden="true"
          >
            <span className="rvo-ring__label">7 ngày</span>
          </span>
        </section>

        <section className="rvo-stat rvo-stat--soon" aria-labelledby="rvo-soon">
          <span className="rvo-stat__ico" aria-hidden="true">
            <Icon name="clock" />
          </span>
          <span className="rvo-stat__text">
            <h2 className="rvo-stat__label" id="rvo-soon">
              Sắp đến hạn
            </h2>
            <dl className="rvo-soon">
              {(
                [
                  ['3 ngày tới', data.upcoming.days3],
                  ['7 ngày tới', data.upcoming.days7],
                  ['14 ngày tới', data.upcoming.days14],
                ] as const
              ).map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd className="tabular">{`${String(value)} thẻ`}</dd>
                </div>
              ))}
            </dl>
          </span>
        </section>
      </div>

      <div className="rvo-layout">
        <section className="rvo-card rvo-cal" aria-labelledby="rvo-cal-title">
          <div className="rvo-cal__head">
            <h2 className="rvo-h2" id="rvo-cal-title">
              Lịch ôn tập
            </h2>
            <span className="rvo-cal__month">{label}</span>
          </div>
          <table className="rvo-cal__table">
            <caption className="sr-only">{`Số thẻ đã ôn theo ngày, ${label}`}</caption>
            <thead>
              <tr>
                {(
                  [
                    ['T2', 'Thứ hai'],
                    ['T3', 'Thứ ba'],
                    ['T4', 'Thứ tư'],
                    ['T5', 'Thứ năm'],
                    ['T6', 'Thứ sáu'],
                    ['T7', 'Thứ bảy'],
                    ['CN', 'Chủ nhật'],
                  ] as const
                ).map(([short, long]) => (
                  <th key={short} scope="col" abbr={long}>
                    {short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, row) => (
                <tr key={row}>
                  {week.map((cell, col) =>
                    cell.out ? (
                      <td key={col} className="is-out" aria-hidden="true">
                        <span>{cell.day}</span>
                      </td>
                    ) : (
                      <td
                        key={col}
                        data-l={cell.level > 0 ? String(cell.level) : undefined}
                      >
                        <span aria-hidden="true">{cell.day}</span>
                        <span className="sr-only">
                          {dayLabel(cell.day, month, cell.reviewed)}
                        </span>
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div
            className="rvo-legend"
            role="group"
            aria-label="Chú giải: màu càng đậm, càng ôn nhiều thẻ"
          >
            <span aria-hidden="true">Ít</span>
            {[1, 2, 3, 4, 5].map((level) => (
              <i key={level} className={`l${String(level)}`} />
            ))}
            <span aria-hidden="true">Nhiều</span>
          </div>
        </section>

        <section className="rvo-card rvo-hist" aria-labelledby="rvo-hist-title">
          <h2 className="rvo-h2" id="rvo-hist-title">
            Lịch sử ôn tập
          </h2>
          {data.recentSessions.length === 0 ? (
            <p className="rvo-fine">Chưa có phiên ôn nào trong 30 ngày qua.</p>
          ) : (
            <table className="rvo-table" aria-labelledby="rvo-hist-title">
              <thead>
                <tr>
                  <th scope="col">Ngày</th>
                  <th scope="col">Số thẻ</th>
                  <th scope="col">Đúng</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSessions.map((session) => (
                  <tr key={session.sessionId}>
                    <td className="tabular">
                      {sessionDate(session.completedAt, data.timezone)}
                    </td>
                    <td className="tabular">{`${String(session.reviewedCount)} thẻ`}</td>
                    <td className="tabular">
                      {session.retentionPercent === null
                        ? '—'
                        : `${String(session.retentionPercent)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="rvo-fine">
            Lịch sử lưu 30 ngày gần nhất; bảng hiện 5 phiên mới nhất.
          </p>
        </section>
      </div>

      <p className="rvo-note w-only">
        <Icon name="info" />
        Lịch tháng tô đậm theo số thẻ đã ôn mỗi ngày.
      </p>
    </>
  );
}

function DueContent({ count }: { count: number }) {
  return (
    <>
      <span className="rvo-stat__ico" aria-hidden="true">
        <Icon name="layers" />
      </span>
      <span className="rvo-stat__text" aria-hidden="true">
        <span className="rvo-stat__label">Đến hạn hôm nay</span>
        <span className="rvo-stat__val tabular">
          {String(count)}
          <small>thẻ</small>
        </span>
      </span>
    </>
  );
}
