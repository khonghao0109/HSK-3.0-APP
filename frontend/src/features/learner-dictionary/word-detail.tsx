'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';
import {
  ToastButton,
  useLearnerToast,
} from '@/features/learner-shell/learner-toast';
import { TOAST_COMING_SOON } from '@/features/learner-shell/learner-toast-messages';

import { NO_VIETNAMESE } from './dictionary-display';
import { Icon } from '@/components/ui/icon';
import { HanziCells } from '@/components/ui/hanzi-cells';
import { WordAudioButton } from '@/features/learner-lesson/word-audio-button';

export const SAVE_FAILED = 'Chưa lưu được. Vui lòng thử lại.';
export const COPY_FAILED = 'Không sao chép được.';

/** What the word page shows; built on the server from the API word. */
export type WordView = {
  id: number;
  hanzi: string;
  /** Only when it differs from `hanzi` (Q68). */
  traditional: string | null;
  pinyin: string;
  /** Every Vietnamese meaning joined with "; " (Q70), or null. */
  vietnamese: string | null;
  /** Q324: the same meanings, one per item of "Nghĩa". */
  meanings: string[];
  level: string | null;
  /** M2.13c2: the speaker button; null hides it. */
  audio?: { mediaId: number } | null;
  /** API `examples[]`, or the old `Word.example` when it is empty (Q311). */
  examples: { hanzi: string; vi: string | null }[];
  /** Distinct sources of the shown examples (Q-C). */
  exampleSources: { name: string; version: string }[];
  source: { name: string; version: string } | null;
  /** Q307: at most 4; pinyin with tone marks, first Vietnamese meaning. */
  related: {
    id: number;
    hanzi: string;
    pinyin: string;
    vietnamese: string | null;
    level: string | null;
  }[];
};

/** Chi tiết từ (M2.6b, mẫu word.html, Q62–Q70). */
export function WordDetail({
  word,
  initialSaved,
}: {
  word: WordView;
  initialSaved: boolean;
}) {
  const router = useRouter();
  const showToast = useLearnerToast();
  const [traditional, setTraditional] = useState(false);
  const [saved, setSaved] = useState(initialSaved);
  const [menuOpen, setMenuOpen] = useState(false);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  // M2.10b: the web hero card has its own ⋮ + menu copies (the app bar and
  // its menu hide at 1024px); the menu tracks which button opened it so
  // focus returns there.
  const moreWebRef = useRef<HTMLButtonElement>(null);
  const menuWebRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !menuWebRef.current?.contains(target) &&
        !moreRef.current?.contains(target) &&
        !moreWebRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      (openerRef.current ?? moreRef.current)?.focus();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // An activated item closes the menu and puts focus back on ⋮ (the item it
  // had disappears with the menu).
  const closeMenu = () => {
    setMenuOpen(false);
    (openerRef.current ?? moreRef.current)?.focus();
  };

  const toggleMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!menuOpen) openerRef.current = event.currentTarget;
    setMenuOpen((open) => !open);
  };

  const copy = async () => {
    closeMenu();
    const text = `${word.hanzi} (${word.pinyin})`;
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Đã sao chép ${text}`);
    } catch {
      showToast(COPY_FAILED);
    }
  };

  // A click while a save is in flight is ignored (the button stays enabled
  // so it keeps focus and its pressed state).
  const toggleSave = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/learner/dictionary/words/${word.id}/save`,
        { method: saved ? 'DELETE' : 'POST' },
      );
      if (response.status === 401) {
        router.replace('/sign-in');
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { data: { saved: boolean } };
      setSaved(body.data.saved);
      showToast(
        body.data.saved
          ? `Đã lưu ${word.hanzi} vào danh sách ôn tập`
          : `Đã bỏ ${word.hanzi} khỏi danh sách ôn tập`,
      );
    } catch {
      showToast(SAVE_FAILED, 'alert');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const onlySource =
    word.exampleSources.length === 1 ? word.exampleSources[0] : undefined;
  const shown = traditional && word.traditional ? word.traditional : word.hanzi;
  // Q333: the hero stays on one line; CSS shrinks it by character count
  // (rules up to 12, learner.css).
  const hanziLength = Math.min(Array.from(shown).length, 12);

  // Shared by the mobile and the web menu copies (only one is visible per
  // viewport; the mobile copy keeps its `.app` anchor below 1024px).
  const menuItems = (
    <>
      <button
        type="button"
        onClick={() => {
          closeMenu();
          showToast(TOAST_COMING_SOON);
        }}
      >
        <Icon name="pen-line" />
        Xem cách viết Hán tự
      </button>
      <button type="button" onClick={() => void copy()}>
        <Icon name="copy" />
        Sao chép từ
      </button>
      <button
        type="button"
        onClick={() => {
          closeMenu();
          showToast(TOAST_COMING_SOON);
        }}
      >
        <Icon name="flag" />
        Báo lỗi nội dung
      </button>
    </>
  );

  return (
    <>
      <header className="appbar appbar--wide word-bar m-only">
        <LearnerBackButton
          fallbackHref="/learn/dictionary"
          icon="chevron-left"
        />
        <span></span>
        <div className="appbar__end">
          {/* Q63: favourites are not built; no aria-pressed. */}
          <ToastButton
            className="icon-btn m03-fav"
            aria-label="Thêm vào yêu thích"
            message={TOAST_COMING_SOON}
          >
            <Icon name="heart" />
          </ToastButton>
          <button
            ref={moreRef}
            className="icon-btn"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="word-menu"
            aria-label="Tuỳ chọn khác"
            onClick={toggleMenu}
          >
            <Icon name="more-vertical" />
          </button>
        </div>
      </header>

      {/* Mobile menu: stays exactly where the mobile layout expects it
          (anchored to `.app`); hidden from 1024px, where the hero copy below
          takes over. */}
      <div
        className="m03-menu m-only"
        id="word-menu"
        ref={menuRef}
        hidden={!menuOpen}
      >
        {menuItems}
      </div>

      <main className="word">
        {/* M2.10b: web breadcrumbs replace the mobile app bar (mẫu
            web/word.html). */}
        <nav className="w-crumbs w-only" aria-label="Đường dẫn">
          <Link href="/learn/dictionary">Tra từ</Link>
          <svg className="icon icon--sm" aria-hidden="true">
            <use href="#i-chevron-right" />
          </svg>
          <span
            aria-current="page"
            lang={traditional && word.traditional ? 'zh-Hant' : 'zh-Hans'}
          >
            {shown}
          </span>
        </nav>
        {/* M2.10b: the wrappers group the sample's cards; below 1024px they
            are display:contents, so the mobile flow is unchanged. */}
        <div className="word-web">
          <div className="word-web__main">
            <section className="word-web__hero" aria-labelledby="word-hz">
              <div className="word__head">
                <h1
                  className={`word__hz word__hz--n${hanziLength}`}
                  id="word-hz"
                  lang={traditional && word.traditional ? 'zh-Hant' : 'zh-Hans'}
                >
                  <HanziCells text={shown} />
                </h1>
              </div>
              <div className="word-web__hero-body">
                <div className="word__mid">
                  <p className="word__py" lang="zh-Latn-pinyin">
                    {word.pinyin}
                  </p>
                  <WordAudioButton
                    audio={word.audio ?? null}
                    hanzi={word.hanzi}
                  />
                  {word.traditional ? (
                    // Q68: switches the headword only, not the example.
                    <div className="seg" role="group" aria-label="Kiểu chữ">
                      <button
                        type="button"
                        aria-pressed={!traditional}
                        onClick={() => setTraditional(false)}
                      >
                        Giản thể
                      </button>
                      <button
                        type="button"
                        aria-pressed={traditional}
                        onClick={() => setTraditional(true)}
                      >
                        Phồn thể
                      </button>
                    </div>
                  ) : null}
                </div>
                {word.vietnamese ? (
                  <p className="word__vi">{word.vietnamese}</p>
                ) : (
                  <p className="word__vi word__vi--none">{NO_VIETNAMESE}</p>
                )}
                {word.level ? (
                  <span className="badge badge--lv">{word.level}</span>
                ) : null}
              </div>
              {/* M2.10b: the web hero card carries its own ⋮ + menu copy
                  (mẫu word.html `.wword-menuwrap`); the mobile pair above
                  stays untouched below 1024px. */}
              <button
                ref={moreWebRef}
                className="icon-btn word-web__more w-only"
                type="button"
                aria-expanded={menuOpen}
                aria-controls="word-menu-web"
                aria-label="Tuỳ chọn khác"
                onClick={toggleMenu}
              >
                <Icon name="more-vertical" />
              </button>
              <div
                className="m03-menu word-web__menu w-only"
                id="word-menu-web"
                ref={menuWebRef}
                hidden={!menuOpen}
              >
                {menuItems}
              </div>
            </section>

            {/* Q324: one item per Vietnamese meaning (mẫu word-full.html). */}
            {word.meanings.length > 0 ? (
              <section
                className="word-sense"
                aria-labelledby="word-sense-title"
              >
                <h2 id="word-sense-title">Nghĩa</h2>
                <ol className="word-sense__list">
                  {word.meanings.map((meaning, index) => (
                    <li key={index}>{meaning}</li>
                  ))}
                </ol>
              </section>
            ) : null}

            {/* M3.4c: mẫu word-full.html puts "Từ liên quan" before "Ví dụ". */}
            {word.related.length > 0 ? (
              <section className="word-rel" aria-labelledby="word-rel-title">
                <h2 id="word-rel-title">Từ liên quan</h2>
                {/* Mobile list (mẫu mobile/word-full.html .uxa-related). */}
                <ul className="word-rel__list m-only">
                  {word.related.map((item) => (
                    <li key={item.id}>
                      <Link href={`/learn/dictionary/${item.id}`}>
                        <span>
                          <span className="word-rel__hz" lang="zh-Hans">
                            {item.hanzi}
                          </span>
                          <span className="word-rel__meta">
                            <span lang="zh-Latn-pinyin">{item.pinyin}</span>
                            {' · '}
                            {item.vietnamese ?? NO_VIETNAMESE}
                          </span>
                        </span>
                        <Icon name="chevron-right" />
                      </Link>
                    </li>
                  ))}
                </ul>
                {/* Web table (mẫu web/word-full.html .uxb-table--related). */}
                <table className="word-rel__table w-only">
                  <caption className="sr-only">
                    Các từ liên quan tới {word.hanzi}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Từ</th>
                      <th scope="col">Pinyin</th>
                      <th scope="col">Nghĩa</th>
                      <th scope="col">Cấp</th>
                      <th scope="col">
                        <span className="sr-only">Mở chi tiết</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {word.related.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <Link
                            className="word-rel__word"
                            href={`/learn/dictionary/${item.id}`}
                            lang="zh-Hans"
                          >
                            {item.hanzi}
                          </Link>
                        </td>
                        <td lang="zh-Latn-pinyin">{item.pinyin}</td>
                        <td>{item.vietnamese ?? NO_VIETNAMESE}</td>
                        <td>
                          {item.level ? (
                            <span className="badge badge--neutral">
                              {item.level}
                            </span>
                          ) : null}
                        </td>
                        <td className="word-rel__end">
                          <Link
                            className="word-rel__open"
                            href={`/learn/dictionary/${item.id}`}
                            aria-label={`Mở chi tiết ${item.hanzi}`}
                          >
                            <Icon name="chevron-right" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            {word.examples.length > 0 ? (
              <section className="word-ex" aria-labelledby="word-ex-title">
                <h2 id="word-ex-title">Ví dụ</h2>
                {/* C3: the mobile card under the heading (mẫu
                    mobile/word-full.html .uxa-card); contents on web. */}
                <div className="word-ex__list">
                  {word.examples.map((example, index) => (
                    <div className="word-ex__item" key={index}>
                      <p className="word-ex__cn">
                        <span className="cn" lang="zh-Hans">
                          {example.hanzi}
                        </span>
                      </p>
                      {example.vi ? (
                        <p className="word-ex__vi">{example.vi}</p>
                      ) : null}
                    </div>
                  ))}
                  {onlySource ? (
                    // Q326: one line, as mẫu web/word-full.html.
                    <footer>
                      <span>
                        Nguồn: {onlySource.name} · Phiên bản{' '}
                        {onlySource.version}
                      </span>
                    </footer>
                  ) : word.exampleSources.length > 1 ? (
                    // Q-C: several sources share one line.
                    <footer>
                      <span>
                        Nguồn:{' '}
                        {word.exampleSources
                          .map((source) => `${source.name} ${source.version}`)
                          .join(' · ')}
                      </span>
                    </footer>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>

          <div className="word-web__aside">
            <div className="word-web__act">
              <h2 className="word-web__act-title w-only">Hành động</h2>
              <button
                className="word-save"
                type="button"
                aria-pressed={saved}
                aria-busy={busy || undefined}
                onClick={() => void toggleSave()}
              >
                <Icon name={saved ? 'check' : 'heart'} />
                <span>{saved ? 'Đã lưu' : 'Lưu để ôn'}</span>
              </button>
              {/* M2.10b: the web aside's ghost favourite button (mẫu
                  word.html); the mobile one sits in the app bar. */}
              <ToastButton
                className="word-web__fav w-only"
                message={TOAST_COMING_SOON}
              >
                <Icon name="heart" />
                Thêm vào yêu thích
                <span className="w-tag w-tag--soon">Sắp có</span>
              </ToastButton>
            </div>
            {/* M2.10b: web-only info card (mẫu word.html); mobile keeps its
                own layout without it. */}
            <section
              className="word-web__info w-only"
              aria-labelledby="word-info-title"
            >
              <h2 className="word-web__info-title" id="word-info-title">
                Thông tin từ
              </h2>
              <dl className="wword-info">
                {word.level ? (
                  <div>
                    <dt>Cấp độ</dt>
                    <dd>{word.level}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Giản thể</dt>
                  <dd lang="zh-Hans">{word.hanzi}</dd>
                </div>
                {word.traditional ? (
                  <div>
                    <dt>Phồn thể</dt>
                    <dd lang="zh-Hant">{word.traditional}</dd>
                  </div>
                ) : null}
                {word.source ? (
                  <>
                    <div>
                      <dt>Nguồn</dt>
                      <dd>{word.source.name}</dd>
                    </div>
                    <div>
                      <dt>Phiên bản</dt>
                      <dd>{word.source.version}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
              {/* Q327: no Hán tự screen yet. */}
              <ToastButton
                className="word-web__hanzi"
                message={TOAST_COMING_SOON}
              >
                <Icon name="pen-line" />
                Xem chi tiết Hán tự
              </ToastButton>
              <LearnerBackButton
                className="word-web__back w-only"
                ariaLabel="Quay lại Tra từ"
                fallbackHref="/learn/dictionary"
              >
                Quay lại Tra từ
              </LearnerBackButton>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
