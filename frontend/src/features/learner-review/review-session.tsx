'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { progressClass } from '@/features/learner-lesson/lesson-player-model';

import {
  REVIEW_GRADES,
  clampDurationMs,
  formatDuration,
  gradeFailureAction,
  intervalLabel,
  progressCounter,
  retentionText,
  reviewCardView,
  type ReviewGrade,
  type ReviewItem,
  type ReviewSession as Session,
  type ReviewSummary,
} from './review-model';
import { ReviewSettings } from './review-settings';
import {
  createReviewTransport,
  type ReviewTransport,
} from './review-transport';

type Phase =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'limit' }
  | { kind: 'error'; retry: 'load' | 'finish' }
  | { kind: 'expired' }
  | { kind: 'cards' }
  | { kind: 'done'; summary: ReviewSummary & { again: number } };

type ShownCard = { hanzi: string; pinyin: string; meaning: string };

// Face icons of the samples: stroked on web (ux-b), filled on mobile (m03).
const FACES: Record<ReviewGrade, string> = {
  again: 'M8 9h.01M16 9h.01M9 17c.4-1.6 1.6-2.5 3-2.5s2.6.9 3 2.5',
  hard: 'M8 9h.01M16 9h.01M8.5 16.5s1.5-1 3.5-1 3.5 1 3.5 1',
  good: 'M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  easy: 'M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
};
const FILLED_MOUTHS: Record<Exclude<ReviewGrade, 'easy'>, string> = {
  again: 'M7.6 17.2c2.4-2.9 6.4-2.9 8.8 0',
  hard: 'M8.2 16.6c2.2-2 5.4-2 7.6 0',
  good: 'M7.4 13.8c2.3 3.4 6.9 3.4 9.2 0',
};
const STAR_EYES =
  'M8 6.1l.73 1.89 2.03.11-1.57 1.29.51 1.96L8 10.25l-1.7 1.1.51-1.96-1.57-1.29 2.03-.11ZM16 6.1l.73 1.89 2.03.11-1.57 1.29.51 1.96L16 10.25l-1.7 1.1.51-1.96-1.57-1.29 2.03-.11Z';

function FaceIcon({ grade }: { grade: ReviewGrade }) {
  return (
    <>
      <svg
        className="icon fc-face-icon w-only"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d={FACES[grade]} />
        {grade === 'easy' && (
          <path
            d="M19 2l.7 1.8L21.5 4.5l-1.8.7L19 7l-.7-1.8L16.5 4.5l1.8-.7Z"
            fill="currentColor"
            stroke="none"
          />
        )}
      </svg>
      <svg
        className="icon fc-face-fill m-only"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="11" fill="currentColor" stroke="none" />
        {grade === 'easy' ? (
          <>
            <path fill="#fff" stroke="none" d={STAR_EYES} />
            <path fill="#fff" stroke="none" d="M7 13.6h10a5 5 0 0 1-10 0Z" />
          </>
        ) : (
          <>
            <path d="M8.3 9.3v.6M15.7 9.3v.6" stroke="#fff" strokeWidth={2.6} />
            <path d={FILLED_MOUTHS[grade]} stroke="#fff" strokeWidth={2} />
          </>
        )}
      </svg>
    </>
  );
}

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

function BulbIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.5 18.5h5M10.5 21.5h3" />
      <path d="M12 6.5a5 5 0 0 0-3.1 8.9c.6.5 1 1.3 1 2.1h4.2c0-.8.4-1.6 1-2.1A5 5 0 0 0 12 6.5Z" />
      <path d="M12 1.5v2M4.6 4.6l1.4 1.4M19.4 4.6 18 6M2 11.5h2M20 11.5h2" />
    </svg>
  );
}

// Pieces of the completion sample; learner.css places each by :nth-child.
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

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

/**
 * M3.3a (Q258–Q264): the flashcard review session. Every call goes through
 * the BFF; the schedule comes from the server preview, never the client.
 */
export function ReviewSession({
  transport: given,
}: {
  transport?: ReviewTransport;
}) {
  const router = useRouter();
  const transport = useMemo(() => given ?? createReviewTransport(), [given]);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [pending, setPending] = useState(false);
  const [gradeError, setGradeError] = useState<ReviewGrade | null>(null);
  const [forgotten, setForgotten] = useState<ShownCard[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // When the current card appeared; set in handlers, never during render.
  const [shownAt, setShownAt] = useState(0);
  // Q262: one key per card; a different grade after a failure gets a new
  // key so the server never sees one key with two bodies (409 CONFLICT).
  const keys = useRef(new Map<number, { grade: ReviewGrade; key: string }>());
  // Synchronous lock: two keypresses in one tick must not send twice.
  const inFlight = useRef(false);
  const createKey = useRef<string | null>(null);
  const flipRef = useRef<HTMLButtonElement>(null);
  const started = useRef(false);

  const signIn = useCallback(() => router.replace('/sign-in'), [router]);

  const finish = useCallback(
    async (sessionId: number) => {
      setPending(true);
      const result = await transport.complete<{
        summary: ReviewSummary & { again: number };
      }>(sessionId);
      setPending(false);
      if (result.ok) {
        setPhase({ kind: 'done', summary: result.data.summary });
        return;
      }
      const action = gradeFailureAction(result.status, result.code);
      if (action === 'unauthorized') return signIn();
      if (action === 'expired') return setPhase({ kind: 'expired' });
      setPhase({ kind: 'error', retry: 'finish' });
    },
    [transport, signIn],
  );

  /** `retrySessionId` (Q278): create the retry of that session first. */
  const load = useCallback(
    async (retrySessionId?: number) => {
      setPhase({ kind: 'loading' });
      let current =
        retrySessionId === undefined
          ? await transport.current<{ session: Session; items: ReviewItem[] }>()
          : ({ ok: false, status: 404, code: null } as const);
      if (!current.ok && current.status === 404) {
        createKey.current ??= crypto.randomUUID();
        const created =
          retrySessionId === undefined
            ? await transport.create(createKey.current)
            : await transport.create(createKey.current, { retrySessionId });
        if (!created.ok) {
          if (created.code === 'REVIEW_NOTHING_DUE') {
            return setPhase({ kind: 'empty' });
          }
          if (created.code === 'REVIEW_DAILY_LIMIT_REACHED') {
            return setPhase({ kind: 'limit' });
          }
          if (created.status === 401 || created.status === 403) return signIn();
          return setPhase({ kind: 'error', retry: 'load' });
        }
        current = await transport.current<{
          session: Session;
          items: ReviewItem[];
        }>();
      }
      if (!current.ok) {
        if (current.status === 401 || current.status === 403) return signIn();
        return setPhase({ kind: 'error', retry: 'load' });
      }
      setSession(current.data.session);
      setItems(current.data.items);
      setIndex(0);
      setFlipped(false);
      setGradeError(null);
      setShownAt(Date.now());
      if (current.data.items.length === 0) {
        await finish(current.data.session.sessionId);
        return;
      }
      setPhase({ kind: 'cards' });
    },
    [transport, signIn, finish],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  const item = items[index];

  const advance = useCallback(() => {
    const next = index + 1;
    setFlipped(false);
    setGradeError(null);
    setShownAt(Date.now());
    if (next >= items.length) {
      if (session) void finish(session.sessionId);
      return;
    }
    setIndex(next);
    flipRef.current?.focus();
  }, [index, items.length, session, finish]);

  const grade = useCallback(
    async (value: ReviewGrade) => {
      // Q266: the front face cannot be graded; flip first.
      if (
        inFlight.current ||
        !flipped ||
        !item ||
        !session ||
        phase.kind !== 'cards'
      ) {
        return;
      }
      const kept = keys.current.get(item.cardId);
      const key = kept?.grade === value ? kept.key : crypto.randomUUID();
      keys.current.set(item.cardId, { grade: value, key });
      inFlight.current = true;
      setPending(true);
      setGradeError(null);
      const result = await transport.grade<{
        session: { reviewedCount: number; plannedCount: number };
      }>(
        session.sessionId,
        {
          cardId: item.cardId,
          grade: value,
          durationMs: clampDurationMs(Date.now() - shownAt),
        },
        key,
      );
      inFlight.current = false;
      setPending(false);
      if (result.ok) {
        setSession({ ...session, ...result.data.session });
        if (value === 'again') {
          const view = reviewCardView(item.word);
          setForgotten((list) => [...list, view]);
        }
        return advance();
      }
      const action = gradeFailureAction(result.status, result.code);
      if (action === 'skip') return advance();
      if (action === 'expired') return setPhase({ kind: 'expired' });
      if (action === 'unauthorized') return signIn();
      setGradeError(value);
    },
    [item, flipped, session, phase.kind, shownAt, transport, advance, signIn],
  );

  useEffect(() => {
    if (phase.kind !== 'cards') return;
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTyping(event.target)) return;
      const choice = REVIEW_GRADES.find((entry) => entry.key === event.key);
      if (!choice) return;
      event.preventDefault();
      void grade(choice.grade);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase.kind, grade]);

  function startOver(retrySessionId?: number) {
    createKey.current = crypto.randomUUID();
    keys.current.clear();
    setForgotten([]);
    void load(retrySessionId);
  }

  function endEarly() {
    if (!session || pending) return;
    if (
      !window.confirm(
        'Kết thúc phiên ôn bây giờ? Thẻ chưa chấm vẫn còn đến hạn.',
      )
    ) {
      return;
    }
    void finish(session.sessionId);
  }

  if (phase.kind === 'done') {
    const sessionId = session?.sessionId;
    return (
      <ReviewComplete
        summary={phase.summary}
        forgotten={forgotten}
        onRetry={
          phase.summary.again > 0 && sessionId !== undefined
            ? () => startOver(sessionId)
            : null
        }
      />
    );
  }

  const planned = session?.plannedCount ?? 0;
  const reviewed = session?.reviewedCount ?? 0;
  const counter = planned > 0 ? progressCounter(reviewed, planned) : null;
  const shown = Math.min(reviewed + 1, planned);
  const view = item ? reviewCardView(item.word) : null;

  return (
    <div className="ex rv">
      <header className="m02-head m02-bar ex-bar">
        <Link className="icon-btn" href="/learn" aria-label="Đóng phiên ôn tập">
          <Icon name="x" />
        </Link>
        <div className="ex-track">
          <h1 className="m02-bar__title">Ôn tập</h1>
          {counter && (
            <div
              className="progress ex-progress ex-progress--web w-only"
              role="progressbar"
              aria-label="Tiến độ phiên ôn tập"
              aria-valuemin={0}
              aria-valuemax={planned}
              aria-valuenow={shown}
              aria-valuetext={`Thẻ ${String(shown)} trên ${String(planned)}`}
            >
              <span className={progressClass(reviewed, planned)} />
            </div>
          )}
        </div>
        <div className="rv-barend">
          {counter && (
            <p className="rv-count w-only">
              <span className="tabular" aria-hidden="true">
                {counter}
              </span>
              <span className="sr-only">{`Thẻ ${String(shown)} trên ${String(planned)}`}</span>
            </p>
          )}
          <button
            className="icon-btn"
            type="button"
            aria-label="Cài đặt ôn tập"
            aria-haspopup="dialog"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>
      {settingsOpen && (
        <ReviewSettings
          open
          transport={transport}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <main className="rv-body" aria-busy={phase.kind === 'loading' || pending}>
        {phase.kind === 'loading' && (
          <p className="rv-state" role="status">
            Đang tải phiên ôn…
          </p>
        )}

        {phase.kind === 'empty' && (
          <section className="rv-state" aria-labelledby="rv-empty">
            <h2 id="rv-empty" className="rv-state__title">
              Không có thẻ đến hạn
            </h2>
            <p className="rv-state__text">
              Lưu thêm từ khi học hoặc tra từ, thẻ sẽ đến hạn để ôn.
            </p>
            <div className="rv-state__actions">
              <Link className="btn btn--outline" href="/learn/path">
                Lộ trình học
              </Link>
              <Link className="btn btn--primary" href="/learn/dictionary">
                Tra từ
              </Link>
            </div>
          </section>
        )}

        {phase.kind === 'limit' && (
          <section className="rv-state" aria-labelledby="rv-limit">
            <h2 id="rv-limit" className="rv-state__title">
              Bạn đã ôn đủ số thẻ hôm nay
            </h2>
            <p className="rv-state__text">
              Thẻ còn lại sẽ chờ đến ngày mai. Đổi số thẻ mỗi ngày trong Cài đặt
              ôn tập.
            </p>
            <div className="rv-state__actions">
              <Link className="btn btn--outline" href="/learn/review">
                Về Ôn tập
              </Link>
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => setSettingsOpen(true)}
              >
                Cài đặt ôn tập
              </button>
            </div>
          </section>
        )}

        {phase.kind === 'error' && (
          <section className="rv-state" role="alert">
            <h2 className="rv-state__title">Chưa tải được phiên ôn</h2>
            <div className="rv-state__actions">
              <button
                className="btn btn--primary"
                type="button"
                onClick={() =>
                  phase.retry === 'finish' && session
                    ? void finish(session.sessionId)
                    : void load()
                }
              >
                Thử lại
              </button>
            </div>
          </section>
        )}

        {phase.kind === 'expired' && (
          <section className="rv-state" role="alert">
            <h2 className="rv-state__title">Phiên ôn đã hết hạn</h2>
            <div className="rv-state__actions">
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => startOver()}
              >
                Bắt đầu phiên mới
              </button>
            </div>
          </section>
        )}

        {phase.kind === 'cards' && item && view && (
          <>
            <div className="fc-top m-only">
              <span className="fc-top__count tabular" aria-hidden="true">
                {counter}
              </span>
              <div
                className="progress"
                role="progressbar"
                aria-label="Tiến độ phiên ôn tập"
                aria-valuemin={0}
                aria-valuemax={planned}
                aria-valuenow={shown}
                aria-valuetext={`Thẻ ${String(shown)} trên ${String(planned)}`}
              >
                <span className={progressClass(reviewed, planned)} />
              </div>
            </div>

            <div className={flipped ? 'fc-scene is-flipped' : 'fc-scene'}>
              <div className="fc-hold">
                <div className="fc-card" aria-live="polite">
                  <div className="fc-face fc-face--front" hidden={flipped}>
                    <p className="fc-hz cn" lang="zh-Hans">
                      {view.hanzi}
                    </p>
                  </div>
                  <div className="fc-face fc-face--back" hidden={!flipped}>
                    <p className="fc-back__vi">{view.meaning}</p>
                    <p className="fc-back__py">
                      <span className="cn" lang="zh-Hans">
                        {view.hanzi}
                      </span>
                      {' · '}
                      <span>{view.pinyin}</span>
                    </p>
                    {view.example && (
                      <p className="fc-back__ex">
                        <span className="cn" lang="zh-Hans">
                          {view.example}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
                <button
                  ref={flipRef}
                  className="fc-flip"
                  type="button"
                  aria-pressed={flipped}
                  aria-label={
                    flipped ? 'Lật lại mặt trước' : 'Lật thẻ để xem nghĩa'
                  }
                  onClick={() => setFlipped((value) => !value)}
                />
              </div>
              <p className="fc-hint">Chạm vào thẻ để lật mặt sau</p>

              {gradeError && (
                <div className="rv-error" role="alert">
                  <p>Chưa lưu được kết quả. Kiểm tra kết nối rồi thử lại.</p>
                  <button
                    className="btn btn--outline"
                    type="button"
                    disabled={pending}
                    onClick={() => void grade(gradeError)}
                  >
                    Thử lại
                  </button>
                </div>
              )}
            </div>

            <div
              className="fc-rate"
              role="group"
              aria-label="Bạn nhớ từ này thế nào?"
            >
              {REVIEW_GRADES.map((entry) => {
                const interval = intervalLabel(
                  item.preview[entry.grade].dueAt,
                  shownAt,
                );
                return (
                  <button
                    key={entry.grade}
                    className={`fc-rate__btn fc-rate__${entry.grade}`}
                    type="button"
                    disabled={pending || !flipped}
                    aria-label={`${entry.label}, gặp lại sau ${interval}`}
                    aria-keyshortcuts={entry.key}
                    onClick={() => void grade(entry.grade)}
                  >
                    <FaceIcon grade={entry.grade} />
                    <span className="fc-rate__label">{entry.label}</span>
                    <span className="fc-rate__when">{interval}</span>
                  </button>
                );
              })}
            </div>

            <div className="rv-foot">
              <p className="fc-tip">
                <BulbIcon />
                <span className="w-only">
                  Mẹo: đánh giá đúng mức để lịch ôn sát với trí nhớ của bạn.
                </span>
                <span className="m-only">
                  Mẹo: Hãy ôn tập thường xuyên để ghi nhớ lâu hơn!
                </span>
              </p>
              <button
                className="rv-end"
                type="button"
                disabled={pending}
                onClick={endEarly}
              >
                Kết thúc phiên
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function ReviewComplete({
  summary,
  forgotten,
  onRetry,
}: {
  summary: ReviewSummary;
  forgotten: ShownCard[];
  /** Q278: null when no card of the session was graded `again`. */
  onRetry: (() => void) | null;
}) {
  const retention = retentionText(summary.retentionPercent);
  const total = summary.remembered + summary.forgot;
  const showForgotten =
    summary.forgot > 0 && forgotten.length === summary.forgot;
  const stats = [
    { title: 'Thẻ đã ôn', value: total },
    { title: 'Nhớ', value: summary.remembered },
    { title: 'Chưa nhớ', value: summary.forgot },
  ];
  return (
    <>
      <div className="done-confetti m-only" aria-hidden="true">
        {CONFETTI.map((className, index) => (
          <i key={index} className={className} />
        ))}
      </div>
      <header className="done-brand w-only">
        <Link className="done-brand__link" href="/learn">
          <span className="done-brand__mark" aria-hidden="true">
            汉
          </span>
          <span className="done-brand__name">Hán Lộ</span>
        </Link>
      </header>
      <main className="done-main rv-done">
        <section className="done-card" aria-labelledby="done-title">
          <div className="done-hero">
            <div className="done-confetti w-only" aria-hidden="true">
              {CONFETTI.map((className, index) => (
                <i key={index} className={className} />
              ))}
            </div>
            <p className="done-kicker">
              Chúc mừng! Bạn đã hoàn thành phiên ôn tập
            </p>
            <h1 className="done-title" id="done-title">
              Ôn tập hôm nay
            </h1>
            <div className="done-medal w-only">
              <img
                src="/images/learner/m02-medal.png"
                alt=""
                width={230}
                height={105}
              />
              <p
                className="done-medal__score"
                aria-label={`Tỷ lệ ghi nhớ ${retention}`}
              >
                {summary.retentionPercent === null ? (
                  '—'
                ) : (
                  <>
                    {summary.retentionPercent}
                    <small>%</small>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="rv-stats">
            {stats.map((stat) => (
              <section className="rv-stat" key={stat.title}>
                <h2>{stat.title}</h2>
                <p>
                  <b>{stat.value}</b>
                  <small> thẻ</small>
                </p>
              </section>
            ))}
          </div>

          <p className="rv-meta">
            {`Tỷ lệ ghi nhớ ${retention}`}
            <span className="rv-dot" aria-hidden="true">
              ·
            </span>
            {`Thời gian ${formatDuration(summary.totalDurationMs)}`}
          </p>

          {showForgotten && (
            <section
              className="rv-again m-only"
              aria-labelledby="rv-again-title"
            >
              <h2 id="rv-again-title">{`${String(summary.forgot)} thẻ chưa nhớ`}</h2>
              <ul>
                {forgotten.map((card, index) => (
                  <li key={index}>
                    <span className="rv-again__hz" lang="zh-Hans">
                      {card.hanzi}
                    </span>
                    <span className="rv-again__meta">{`${card.pinyin} · ${card.meaning}`}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div
            className={
              onRetry
                ? 'done-actions rv-actions rv-actions--two'
                : 'done-actions rv-actions'
            }
          >
            <Link
              className={
                onRetry
                  ? 'done-btn done-btn--light'
                  : 'done-btn done-btn--primary'
              }
              href="/learn/review"
            >
              Về Ôn tập
            </Link>
            {onRetry && (
              <button
                className="done-btn done-btn--primary"
                type="button"
                onClick={onRetry}
              >
                Ôn lại thẻ chưa nhớ
                <Icon name="rotate-ccw" />
              </button>
            )}
          </div>
          <p className="rv-note">
            Phiên ôn không cộng XP hay huy hiệu. Thẻ chưa nhớ sẽ quay lại sớm
            hơn.
          </p>
        </section>
      </main>
    </>
  );
}
