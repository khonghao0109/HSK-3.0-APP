'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

import { Icon } from '@/components/ui/icon';

import {
  matchingProgress,
  matchingRows,
  type MatchingMove,
  type MatchingPair,
} from './lesson-player-model';

/** How long a wrong pair stays red before both cells clear. */
export const MATCHING_WRONG_MS = 700;
/** Slide of a meaning onto its word row (PO 20/11/2026: ≤ 200ms). */
const MATCHING_SLIDE_MS = 180;

type Side = 'left' | 'right';
type Cell = { side: Side; id: string };

/**
 * Pha E: ghép cặp. Tap only (no drag, WCAG 2.5.7): pick a cell in one column,
 * then one in the other. A right pair locks and its meaning slides onto the
 * row of its word (PO 20/11/2026); a wrong one shows ✕ and clears. Every cell
 * is a button, so Tab + Enter/Space work as is.
 */
export function MatchingExercise({
  prompt,
  pairs,
  rightOrder,
  moves,
  locked,
  headingRef,
  onMove,
}: {
  prompt: string;
  pairs: MatchingPair[];
  rightOrder: string[];
  moves: readonly MatchingMove[];
  /** Sending or checked: nothing can change. */
  locked: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onMove: (move: MatchingMove) => void;
}) {
  const [selected, setSelected] = useState<Cell | null>(null);
  const [wrong, setWrong] = useState<MatchingMove | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const focusAfterRef = useRef<string | null>(null);
  const leftColumnRef = useRef<HTMLUListElement | null>(null);
  const rightColumnRef = useRef<HTMLUListElement | null>(null);
  const rightTopsRef = useRef(new Map<string, number>());

  const byId = new Map(pairs.map((pair) => [pair.id, pair]));
  const done = matchingProgress(moves).locked;
  const leftIds = pairs.map((pair) => pair.id);
  const rows = matchingRows(leftIds, rightOrder, moves);
  const rowsKey = rows.join(',');

  useEffect(() => {
    if (!wrong) return;
    const timer = window.setTimeout(() => setWrong(null), MATCHING_WRONG_MS);
    return () => window.clearTimeout(timer);
  }, [wrong]);

  // FLIP: a meaning that changed row slides from where it was. Cells keep
  // their React key (pair id), so the node and its focus survive the move.
  useLayoutEffect(() => {
    const cells = [
      ...(rightColumnRef.current?.querySelectorAll<HTMLElement>(
        '.mt-cell[data-pair]',
      ) ?? []),
    ];
    const before = rightTopsRef.current;
    const reduce = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const tops = new Map<string, number>();
    for (const cell of cells) {
      const id = cell.dataset.pair ?? '';
      const top = cell.getBoundingClientRect().top;
      tops.set(id, top);
      const from = before.get(id);
      if (
        reduce ||
        from === undefined ||
        from === top ||
        typeof cell.animate !== 'function'
      ) {
        continue;
      }
      cell.animate(
        [{ transform: `translateY(${from - top}px)` }, { transform: 'none' }],
        { duration: MATCHING_SLIDE_MS, easing: 'ease-out' },
      );
    }
    rightTopsRef.current = tops;
  }, [rowsKey]);

  // After a pair locks its cells turn aria-disabled; focus the next open
  // word below the matched one (wrapping to the top).
  useEffect(() => {
    const matched = focusAfterRef.current;
    focusAfterRef.current = null;
    if (!matched) return;
    const words = [
      ...(leftColumnRef.current?.querySelectorAll<HTMLElement>('.mt-cell') ??
        []),
    ];
    const start = words.findIndex((word) => word.dataset.pair === matched);
    for (let step = 1; step <= words.length; step += 1) {
      const word = words[(start + step) % words.length];
      if (word && word.getAttribute('aria-disabled') !== 'true') {
        word.focus();
        return;
      }
    }
  }, [moves]);

  const leftLabel = (pair: MatchingPair) =>
    pair.leftReading ? `${pair.left} ${pair.leftReading}` : pair.left;

  const tap = (cell: Cell) => {
    if (locked || wrong || done.has(cell.id)) return;
    if (!selected || selected.side === cell.side) {
      setSelected(
        selected?.side === cell.side && selected.id === cell.id ? null : cell,
      );
      return;
    }
    const move: MatchingMove =
      cell.side === 'left'
        ? { leftId: cell.id, rightId: selected.id }
        : { leftId: selected.id, rightId: cell.id };
    setSelected(null);
    const left = byId.get(move.leftId);
    const right = byId.get(move.rightId);
    if (!left || !right) return;
    if (move.leftId === move.rightId) {
      const remaining = pairs.length - done.size - 1;
      setAnnouncement(
        `Đúng: ${leftLabel(left)} là ${right.right}. ${
          remaining === 0
            ? `Đã ghép xong cả ${pairs.length} cặp.`
            : `Còn ${remaining} cặp.`
        }`,
      );
      focusAfterRef.current = move.leftId;
    } else {
      setWrong(move);
      setAnnouncement(
        `Chưa đúng: ${leftLabel(left)} không phải ${right.right}. Chọn lại.`,
      );
    }
    onMove(move);
  };

  const cellState = (cell: Cell) => {
    const isWrong =
      wrong !== null &&
      (cell.side === 'left' ? wrong.leftId : wrong.rightId) === cell.id;
    const isDone = done.has(cell.id);
    const pressed =
      isWrong || (selected?.side === cell.side && selected.id === cell.id);
    return { isWrong, isDone, pressed };
  };

  const renderCell = (cell: Cell, pair: MatchingPair) => {
    const { isWrong, isDone, pressed } = cellState(cell);
    const text = cell.side === 'left' ? leftLabel(pair) : pair.right;
    return (
      <li key={cell.id}>
        <button
          className={`mt-cell${isDone ? ' is-done' : ''}${isWrong ? ' is-wrong' : ''}`}
          type="button"
          data-pair={cell.id}
          aria-pressed={pressed}
          aria-disabled={isDone || locked ? 'true' : undefined}
          aria-label={isDone ? `${text}, đã ghép` : undefined}
          onClick={() => tap(cell)}
        >
          {cell.side === 'left' ? (
            <>
              {pair.leftReading && (
                <span className="mt-cell__py" lang="zh-Latn-pinyin">
                  {pair.leftReading}
                </span>
              )}
              <span className="mt-cell__hz" lang="zh-Hans">
                {pair.left}
              </span>
            </>
          ) : (
            <span>{pair.right}</span>
          )}
          {isDone && <Icon name="check-circle" className="mt-cell__mark" />}
          {isWrong && <Icon name="x-circle" className="mt-cell__mark" />}
        </button>
      </li>
    );
  };

  return (
    <>
      <h2 className="pr-q" id="ex-q" ref={headingRef} tabIndex={-1}>
        {prompt}
      </h2>
      <p className="pr-hint mt-hint" id="mt-hint">
        Chọn một ô bên trái, rồi chọn nghĩa của nó bên phải. Bấm lại ô đang chọn
        để bỏ chọn.
      </p>
      <div className="mt-grid" aria-describedby="mt-hint">
        <div>
          <p className="mt-col__label" id="mt-col-left">
            Từ
          </p>
          <ul
            className="mt-col"
            aria-labelledby="mt-col-left"
            ref={leftColumnRef}
          >
            {pairs.map((pair) =>
              renderCell({ side: 'left', id: pair.id }, pair),
            )}
          </ul>
        </div>
        <div>
          <p className="mt-col__label" id="mt-col-right">
            Nghĩa
          </p>
          <ul
            className="mt-col"
            aria-labelledby="mt-col-right"
            ref={rightColumnRef}
          >
            {rows.map((id) => {
              const pair = byId.get(id);
              return pair ? renderCell({ side: 'right', id }, pair) : null;
            })}
          </ul>
        </div>
      </div>
      {/* One result per pair; the player's own region speaks the sheet. */}
      <p className="sr-only mt-live" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
