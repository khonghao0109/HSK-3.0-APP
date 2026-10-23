'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import { ToastButton } from '@/features/learner-shell/learner-toast';
import { TOAST_COMING_SOON } from '@/features/learner-shell/learner-toast-messages';

import type { DictionarySearchItem } from './dictionary-contract';
import {
  displayPinyin,
  firstVietnamese,
  NO_VIETNAMESE,
  normalizeSearchQuery,
  SEARCH_QUERY_MAX_LENGTH,
} from './dictionary-display';

export const SEARCH_DEBOUNCE_MS = 300;

type SearchState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  /** `q`: the query these items answer. */
  | { kind: 'results'; q: string; items: DictionarySearchItem[] }
  | { kind: 'error' };

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

function syncUrl(q: string | null): void {
  window.history.replaceState(
    null,
    '',
    q === null
      ? '/learn/dictionary'
      : `/learn/dictionary?q=${encodeURIComponent(q)}`,
  );
}

function rowLabel(item: DictionarySearchItem): string {
  const vi = firstVietnamese(item.meanings) ?? NO_VIETNAMESE;
  const label = `${item.hanzi} ${displayPinyin(item)}: ${vi}`;
  return item.level ? `${label}, ${item.level}` : label;
}

function ResultRow({
  item,
  top,
}: {
  item: DictionarySearchItem;
  top: boolean;
}) {
  const vi = firstVietnamese(item.meanings);
  // M2.10d F9: the web table paints the level as a pastel pill per level
  // (mẫu .wdict-lv--n); levels without a pill class keep the neutral pill.
  const lv = item.level?.match(/HSK (\d)/u)?.[1];
  const badge = item.level ? (
    <span className={lv ? `badge badge--lv${lv}` : 'badge'} aria-hidden="true">
      {item.level}
    </span>
  ) : null;
  return (
    <li className={top ? 'dict-item dict-item--top' : 'dict-item'}>
      <Link
        className="dict-item__link"
        href={`/learn/dictionary/${item.id}`}
        prefetch={false}
        aria-label={rowLabel(item)}
      />
      <span className="dict-item__hz" lang="zh-Hans" aria-hidden="true">
        {item.hanzi}
      </span>
      <span className="dict-item__body">
        <span className="dict-item__py" aria-hidden="true">
          {displayPinyin(item)}
        </span>
        {/* Q65, Q70: the first Vietnamese meaning, never the English one. */}
        {vi ? (
          <span className="dict-item__vi" aria-hidden="true">
            {vi}
          </span>
        ) : (
          <span
            className="dict-item__vi dict-item__vi--none"
            aria-hidden="true"
          >
            {NO_VIETNAMESE}
          </span>
        )}
        {top ? badge : null}
      </span>
      {top ? null : badge}
      {/* M2.10b: the web table row ends with a chevron (mẫu .wdict-row). */}
      <svg className="icon dict-item__chevron w-only" aria-hidden="true">
        <use href="#i-chevron-right" />
      </svg>
    </li>
  );
}

/**
 * Tra từ (M2.6b, mẫu dictionary.html, Q62–Q70). Searches through the BFF as
 * the learner types; the server page renders the first result of `?q=`.
 */
export function DictionarySearch({
  initialQuery,
  initialItems,
}: {
  initialQuery: string;
  /** Server result for `initialQuery`; null when that search failed. */
  initialItems: DictionarySearchItem[] | null;
}) {
  const router = useRouter();
  const urlQuery = useSearchParams().get('q') ?? '';
  const urlQ = normalizeSearchQuery(urlQuery);
  // Back navigation can restore this page with a URL query typed after the
  // server render; that query is searched again on mount.
  const stale = (urlQ ?? '') !== initialQuery;
  // An invalid `?q=` reads as an empty box.
  const [query, setQuery] = useState(urlQ === null ? '' : urlQuery);
  const [state, setState] = useState<SearchState>(() =>
    urlQ === null
      ? { kind: 'empty' }
      : stale
        ? { kind: 'loading' }
        : initialItems === null
          ? { kind: 'error' }
          : { kind: 'results', q: initialQuery, items: initialItems },
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const [searching, setSearching] = useState(false);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    inFlight.current?.abort();
    inFlight.current = null;
  };

  /** One search; sets no state itself, so the mount effect may start it. */
  const requestSearch = async (
    q: string,
    signal: AbortSignal,
  ): Promise<SearchState | 'sign-in'> => {
    try {
      const response = await fetch(
        `/api/learner/dictionary?q=${encodeURIComponent(q)}`,
        { signal, cache: 'no-store' },
      );
      // The BFF has cleared the session cookies.
      if (response.status === 401) return 'sign-in';
      if (!response.ok) return { kind: 'error' };
      const body = (await response.json()) as { data: DictionarySearchItem[] };
      return { kind: 'results', q, items: body.data };
    } catch {
      return { kind: 'error' };
    }
  };

  const search = (q: string) => {
    cancel();
    const controller = new AbortController();
    inFlight.current = controller;
    void requestSearch(q, controller.signal).then((outcome) => {
      // A newer search or the clear button replaced this one: drop it.
      if (controller.signal.aborted) return;
      inFlight.current = null;
      setSearching(false);
      if (outcome === 'sign-in') router.replace('/sign-in');
      else setState(outcome);
    });
  };

  const schedule = (value: string) => {
    cancel();
    const q = normalizeSearchQuery(value);
    syncUrl(q);
    // Busy from the keystroke until the result (the mount search is 'loading').
    setSearching(q !== null);
    if (q === null) {
      setState({ kind: 'empty' });
      return;
    }
    timer.current = setTimeout(() => search(q), SEARCH_DEBOUNCE_MS);
  };

  const searchStale = useEffectEvent(() => {
    if (stale && urlQ !== null) search(urlQ);
  });
  const stopSearch = useEffectEvent(() => cancel());

  useEffect(() => {
    searchStale();
    return () => stopSearch();
  }, []);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Only results of what is in the box now: not the previous query's while
    // the debounce or the request is still pending.
    const first =
      state.kind === 'results' && state.q === normalizeSearchQuery(query)
        ? state.items[0]
        : undefined;
    if (first) router.push(`/learn/dictionary/${first.id}`);
  };

  const clear = () => {
    setQuery('');
    schedule('');
    inputRef.current?.focus();
  };

  const retry = () => {
    const q = normalizeSearchQuery(query);
    if (q === null) return;
    setSearching(true);
    search(q);
  };

  const count =
    state.kind === 'empty'
      ? 'Nhập từ cần tra'
      : state.kind === 'results'
        ? `Kết quả (${state.items.length})`
        : 'Kết quả';

  return (
    <>
      <header className="appbar m-only">
        <Link className="icon-btn" href="/learn" aria-label="Quay lại">
          <Icon name="chevron-left" />
        </Link>
        <h1 className="appbar__title">Từ điển</h1>
        <div className="appbar__end">
          <ToastButton
            className="icon-btn"
            aria-label="Lịch sử tra cứu"
            message={TOAST_COMING_SOON}
          >
            <Icon name="history" />
          </ToastButton>
        </div>
      </header>

      <main className="dict m03-tabbed">
        {/* M2.10b: web page head + 2-column grid (mẫu web/dictionary.html).
            The wrappers are display:contents below 1024px, so the mobile
            layout keeps its exact flow. */}
        <div className="w-pagehead w-only">
          <div>
            <h1 className="w-h1">Từ điển</h1>
            <p className="w-lead">Tra chữ Hán, pinyin hoặc nghĩa tiếng Việt.</p>
          </div>
        </div>
        <div className="dict-web">
          <div className="dict-web__main">
            <form className="dict-search" role="search" onSubmit={onSubmit}>
              <div className="dict-search__field">
                <Icon name="search" />
                <label className="sr-only" htmlFor="dict-q">
                  Tra từ: chữ Hán, pinyin hoặc nghĩa tiếng Việt
                </label>
                <input
                  ref={inputRef}
                  className="dict-search__input cn"
                  id="dict-q"
                  name="q"
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    schedule(event.target.value);
                  }}
                  lang="zh-Hans"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={SEARCH_QUERY_MAX_LENGTH}
                  placeholder="Nhập chữ Hán, pinyin, nghĩa"
                  aria-controls="dict-results"
                  aria-describedby="dict-count"
                />
                <button
                  className="dict-search__clear"
                  type="button"
                  aria-label="Xoá nội dung tìm kiếm"
                  hidden={query.trim() === ''}
                  onClick={clear}
                >
                  <Icon name="m03-clear" />
                </button>
                {/* Web-only submit (mẫu .wdict-field .w-btn); mobile submits
                    with Enter. */}
                <button className="dict-search__submit w-only" type="submit">
                  Tra từ
                </button>
              </div>
              <div className="dict-search__tools">
                <ToastButton
                  aria-label="Tra bằng chữ viết tay"
                  message={TOAST_COMING_SOON}
                >
                  <Icon name="m03-pen" />
                  <span className="dict-tools__label w-only">
                    Viết tay
                    <span className="w-tag w-tag--soon">Sắp có</span>
                  </span>
                </ToastButton>
                <ToastButton
                  aria-label="Tra bằng ảnh chụp"
                  message={TOAST_COMING_SOON}
                >
                  <Icon name="camera" />
                  <span className="dict-tools__label w-only">
                    Ảnh chụp
                    <span className="w-tag w-tag--soon">Sắp có</span>
                  </span>
                </ToastButton>
                <ToastButton
                  aria-label="Tra bằng giọng nói"
                  message={TOAST_COMING_SOON}
                >
                  <Icon name="m03-mic" />
                  <span className="dict-tools__label w-only">
                    Giọng nói
                    <span className="w-tag w-tag--soon">Sắp có</span>
                  </span>
                </ToastButton>
              </div>
            </form>

            <div className="dict-web__box">
              <h2 className="dict__count" id="dict-count" aria-live="polite">
                {count}
              </h2>
              {/* Column headers of the web result table (mẫu
                  .wdict-cols); the rows announce their own content. */}
              <div className="dict-web__cols w-only" aria-hidden="true">
                <span>Chữ Hán</span>
                <span>Pinyin</span>
                <span>Nghĩa</span>
                <span>Cấp</span>
              </div>
              <ul
                className="dict-results"
                id="dict-results"
                aria-labelledby="dict-count"
                aria-busy={searching || state.kind === 'loading' || undefined}
              >
                {state.kind === 'empty' ? (
                  <li className="dict-empty">
                    <Icon name="search" />
                    <span>
                      Gõ chữ Hán, pinyin hoặc nghĩa tiếng Việt để tra từ.
                    </span>
                  </li>
                ) : state.kind === 'error' ? (
                  <li className="dict-empty">
                    {/* The alert sits inside the item: an li keeps its list role. */}
                    <div role="alert">
                      <Icon name="file-question" />
                      <strong>Không tra được lúc này</strong>
                      <span>Vui lòng thử lại.</span>
                      <button
                        className="dict-retry"
                        type="button"
                        onClick={retry}
                      >
                        Thử lại
                      </button>
                    </div>
                  </li>
                ) : state.kind === 'loading' ? null : state.items.length ===
                  0 ? (
                  <li className="dict-empty">
                    <Icon name="file-question" />
                    <strong>Không tìm thấy kết quả</strong>
                    <span>
                      Thử nhập chữ Hán khác, pinyin không dấu hoặc nghĩa tiếng
                      Việt.
                    </span>
                  </li>
                ) : (
                  state.items.map((item, index) => (
                    <ResultRow key={item.id} item={item} top={index === 0} />
                  ))
                )}
              </ul>

              <ToastButton className="dict-more" message={TOAST_COMING_SOON}>
                <Icon name="m03-read" />
                <span>Xem thêm trong Từ điển Hán Lộ</span>
                <Icon name="chevron-right" />
              </ToastButton>
            </div>
          </div>

          {/* M2.10b: the web aside cards (mẫu web/dictionary.html). Web-only:
              the mobile layout has no equivalent (the history entry lives in
              the app bar there). */}
          <div className="dict-web__aside w-only">
            <section
              className="dict-web__card"
              aria-labelledby="dict-history-title"
            >
              <div className="dict-web__aside-head">
                <h2 className="dict-web__card-title" id="dict-history-title">
                  Tra gần đây
                </h2>
                <span className="w-tag w-tag--soon">Sắp có</span>
              </div>
              <p className="w-muted">
                Lịch sử tra cứu sẽ hiện ở đây để bạn mở lại nhanh các từ đã tra.
              </p>
              <ToastButton
                className="dict-web__ghost"
                message={TOAST_COMING_SOON}
              >
                <Icon name="history" />
                Lịch sử tra cứu
              </ToastButton>
            </section>
            <section
              className="dict-web__card"
              aria-labelledby="dict-tips-title"
            >
              <h2 className="dict-web__card-title" id="dict-tips-title">
                Mẹo tra từ
              </h2>
              <ul className="dict-web__tips">
                <li>
                  <b lang="zh-Hans">学习</b>
                  <span>Gõ chữ Hán</span>
                </li>
                <li>
                  <b>xuexi</b>
                  <span>Pinyin không dấu</span>
                </li>
                <li>
                  <b>học tập</b>
                  <span>Nghĩa tiếng Việt</span>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
