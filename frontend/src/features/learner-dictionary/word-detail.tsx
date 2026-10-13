'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';
import {
  ToastButton,
  useLearnerToast,
} from '@/features/learner-shell/learner-toast';
import { TOAST_COMING_SOON } from '@/features/learner-shell/learner-toast-messages';

import { NO_VIETNAMESE } from './dictionary-display';

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
  level: string | null;
  example: string | null;
  source: { name: string; version: string } | null;
};

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !moreRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      moreRef.current?.focus();
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
    moreRef.current?.focus();
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

  const shown = traditional && word.traditional ? word.traditional : word.hanzi;

  return (
    <>
      <header className="appbar appbar--wide word-bar">
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
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name="more-vertical" />
          </button>
        </div>
      </header>
      <div className="m03-menu" id="word-menu" ref={menuRef} hidden={!menuOpen}>
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
      </div>

      <main className="word">
        <div className="word__head">
          <h1
            className="word__hz"
            lang={traditional && word.traditional ? 'zh-Hant' : 'zh-Hans'}
          >
            {shown}
          </h1>
        </div>
        <div className="word__mid">
          <p className="word__py" lang="zh-Latn-pinyin">
            {word.pinyin}
          </p>
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

        {word.example ? (
          <section className="word-ex" aria-labelledby="word-ex-title">
            <h2 id="word-ex-title">Ví dụ</h2>
            <p className="word-ex__cn">
              <span className="cn" lang="zh-Hans">
                {word.example}
              </span>
            </p>
            {word.source ? (
              <footer>
                <span>Nguồn: {word.source.name}</span>
                <span>Phiên bản: {word.source.version}</span>
              </footer>
            ) : null}
          </section>
        ) : null}

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
      </main>
    </>
  );
}
