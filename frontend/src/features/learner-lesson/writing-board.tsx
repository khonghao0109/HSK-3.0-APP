'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Icon } from '@/components/ui/icon';

import type { WordStrokes } from './stroke-data';
import {
  GLYPH_TRANSFORM,
  matchStroke,
  medianLength,
  medianPath,
  toDataPoint,
  type Point,
} from './strokes';

type Props = {
  hanzi: string;
  pinyin: string | null;
  data: WordStrokes;
  onClose: () => void;
};

type Mode = 'play' | 'write';

const STROKE_MS = 500;
const NEXT_CHAR_MS = 700;

const REDUCED = '(prefers-reduced-motion: reduce)';
function subscribeMotion(change: () => void) {
  const query = window.matchMedia?.(REDUCED);
  query?.addEventListener('change', change);
  return () => query?.removeEventListener('change', change);
}
const reducedMotion = () => window.matchMedia?.(REDUCED).matches ?? false;

/**
 * Bảng Viết (mẫu vu-writing, Pha G2d): xem nét chạy theo thứ tự hoặc tự viết
 * từng nét, so ở máy (không chấm, không gửi gì). Từ nhiều chữ: xong chữ này tự
 * sang chữ sau (Q-G5). Path nét chỉ vào thuộc tính `d` qua JSX.
 */
export function WritingBoard({ hanzi, pinyin, data, onClose }: Props) {
  const { characters } = data;
  const reduced = useSyncExternalStore(
    subscribeMotion,
    reducedMotion,
    () => false,
  );
  const [charIndex, setCharIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('play');
  const [done, setDone] = useState(0);
  const [run, setRun] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [miss, setMiss] = useState(0);
  const [ink, setInk] = useState<Point[] | null>(null);
  const [say, setSay] = useState('');
  const dialog = useRef<HTMLDivElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const animPath = useRef<SVGPathElement | null>(null);
  const drawing = useRef<Point[] | null>(null);

  const character = characters[charIndex] ?? characters[0];
  const total = character?.strokes.length ?? 0;
  const many = characters.length > 1;
  const charLabel = many ? `Chữ ${charIndex + 1}/${characters.length} · ` : '';
  const status =
    done >= total
      ? `${charLabel}Xong ${total}/${total} nét`
      : `${charLabel}Nét ${done + 1}/${total}`;

  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
  }, []);

  // Esc closes from anywhere while the board is open: drawing on the board
  // leaves focus on the page body.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [onClose]);

  // Xem viết: one stroke after another; reduced motion shows them at once.
  useEffect(() => {
    if (mode !== 'play' || !character) return;
    let cancelled = false;
    let running: Animation | null = null;
    const animate = async () => {
      for (let i = 0; i < character.strokes.length; i++) {
        if (cancelled) return;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const path = animPath.current;
        const median = character.medians[i];
        if (!reduced && path && median && typeof path.animate === 'function') {
          const length = medianLength(median) + 160;
          path.style.strokeDasharray = `${length} ${length}`;
          running = path.animate(
            [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
            { duration: STROKE_MS, easing: 'ease-in-out', fill: 'forwards' },
          );
          await running.finished.catch(() => undefined);
        }
        if (cancelled) return;
        setDone(i + 1);
      }
    };
    void animate();
    return () => {
      cancelled = true;
      running?.cancel();
    };
  }, [mode, character, reduced, run]);

  // Viết xong một chữ: sang chữ sau sau một nhịp ngắn.
  useEffect(() => {
    if (mode !== 'write' || done < total || charIndex >= characters.length - 1)
      return;
    const timer = setTimeout(() => {
      setCharIndex((i) => i + 1);
      setDone(0);
      setSay(
        `Chữ ${charIndex + 2}/${characters.length}. Viết nét 1 trên ${characters[charIndex + 1]?.strokes.length ?? 0}`,
      );
    }, NEXT_CHAR_MS);
    return () => clearTimeout(timer);
  }, [mode, done, total, charIndex, characters]);

  const play = () => {
    setMode('play');
    setDone(0);
    setInk(null);
    setRun((r) => r + 1);
  };
  const write = () => {
    setMode('write');
    setDone(0);
    setInk(null);
    setSay(`Viết nét 1 trên ${total}`);
  };

  const boardPoint = (event: React.PointerEvent<SVGSVGElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return toDataPoint(
      ((event.clientX - box.left) / box.width) * 1024,
      ((event.clientY - box.top) / box.height) * 1024,
    );
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mode !== 'write' || done >= total) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drawing.current = [boardPoint(event)];
    setInk(drawing.current);
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return;
    drawing.current = [...drawing.current, boardPoint(event)];
    setInk(drawing.current);
  };
  const onPointerUp = () => {
    const drawn = drawing.current;
    drawing.current = null;
    setInk(null);
    const expected = character?.medians[done];
    if (!drawn || !expected) return;
    if (matchStroke(drawn, expected).ok) {
      const next = done + 1;
      setDone(next);
      setSay(
        next >= total
          ? charIndex < characters.length - 1
            ? `Viết xong chữ ${character.hanzi}`
            : 'Viết xong chữ'
          : `Đúng. Nét ${next + 1}`,
      );
    } else {
      setMiss((m) => m + 1);
      setSay('Chưa khớp, thử lại nét này');
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !dialog.current) return;
    const focusable = Array.from(
      dialog.current.querySelectorAll<HTMLElement>('button, a[href]'),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  if (!character) return null;
  const current = character.medians[done];
  const animating = mode === 'play' && done < total;

  return (
    <div className="g-scrim">
      <div
        className="g-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="g-write-title"
        ref={dialog}
        onKeyDown={onKeyDown}
      >
        <button
          className="g-dialog__close"
          type="button"
          aria-label="Đóng bảng viết"
          ref={closeButton}
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
        <h2 className="g-dialog__title" id="g-write-title">
          Viết <span lang="zh-Hans">{hanzi}</span>
          {pinyin && (
            <>
              {' '}
              <span lang="zh-Latn-pinyin">{pinyin}</span>
            </>
          )}
        </h2>
        <div
          key={miss}
          className={[
            'g-board',
            hidden ? 'is-hidden' : '',
            miss > 0 ? 'is-miss' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="img"
          aria-label={`Lưới chữ điền và chữ ${character.hanzi}, ${total} nét`}
          data-mode={mode}
        >
          <svg
            viewBox="0 0 1024 1024"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              drawing.current = null;
              setInk(null);
            }}
          >
            <defs>
              {mode === 'play' && done < total && (
                <clipPath id="g-write-clip">
                  <path d={character.strokes[done]} />
                </clipPath>
              )}
            </defs>
            <path className="grid" d="M2 2H1022V1022H2Z" />
            <path
              className="grid grid--dash"
              d="M512 0V1024M0 512H1024M0 0 1024 1024M1024 0 0 1024"
            />
            <g transform={GLYPH_TRANSFORM}>
              {character.strokes.map((d, i) => (
                <path key={`ghost-${i}`} className="ghost" d={d} />
              ))}
              {character.strokes.slice(0, done).map((d, i) => (
                <path key={`done-${i}`} className="done" d={d} />
              ))}
              {animating && current && (
                <g clipPath="url(#g-write-clip)">
                  <path
                    key={`anim-${charIndex}-${done}`}
                    ref={animPath}
                    className="anim"
                    d={medianPath(current)}
                  />
                </g>
              )}
              {mode === 'write' && current && (
                <path className="hint" d={medianPath(current)} />
              )}
              {ink && ink.length > 1 && (
                <path className="ink" d={medianPath(ink)} />
              )}
            </g>
          </svg>
        </div>
        <p className="g-wstat">{status}</p>
        <div className="g-wtools" role="group" aria-label="Chế độ bảng viết">
          <button
            className="g-wtool"
            type="button"
            aria-pressed={mode === 'play'}
            onClick={play}
          >
            <Icon name="play" />
            <span>Xem viết</span>
          </button>
          <button
            className="g-wtool"
            type="button"
            aria-pressed={mode === 'write'}
            onClick={write}
          >
            <Icon name="pencil" />
            <span>Tự viết</span>
          </button>
          <button
            className="g-wtool"
            type="button"
            aria-pressed={hidden}
            onClick={() => setHidden((h) => !h)}
          >
            <Icon name="eye-off" />
            <span>{hidden ? 'Hiện mẫu' : 'Ẩn mẫu'}</span>
          </button>
        </div>
        {data.sources.map((source) => (
          <p key={source.code} className="g-attrib">
            {source.referenceUrl ? (
              <a
                href={source.referenceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {source.attribution}
              </a>
            ) : (
              source.attribution
            )}
          </p>
        ))}
        <p className="sr-only" role="status" aria-live="polite">
          {`${status}. ${say}`}
        </p>
      </div>
    </div>
  );
}
