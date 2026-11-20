'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

import { Icon } from '@/components/ui/icon';

import {
  matchingProgress,
  type MatchingMove,
  type MatchingPair,
} from './lesson-player-model';

/** How long a wrong pair stays red before both cells clear. */
export const MATCHING_WRONG_MS = 700;

type Side = 'left' | 'right';
type Cell = { side: Side; id: string };

/**
 * Pha E: ghép cặp. Tap only (no drag, WCAG 2.5.7): pick a cell in one column,
 * then one in the other. A right pair locks in place; a wrong one shows ✕ and
 * clears. Every cell is a button, so Tab + Enter/Space work as is.
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
  const focusAfterRef = useRef<Side | null>(null);
  const columnsRef = useRef<Record<Side, HTMLUListElement | null>>({
    left: null,
    right: null,
  });

  const byId = new Map(pairs.map((pair) => [pair.id, pair]));
  const done = matchingProgress(moves).locked;

  useEffect(() => {
    if (!wrong) return;
    const timer = window.setTimeout(() => setWrong(null), MATCHING_WRONG_MS);
    return () => window.clearTimeout(timer);
  }, [wrong]);

  // After a pair locks its cells turn aria-disabled; keep focus in the column
  // that was tapped last, on its first open cell.
  useEffect(() => {
    const side = focusAfterRef.current;
    focusAfterRef.current = null;
    if (!side) return;
    const open = (root: HTMLUListElement | null) =>
      root?.querySelector<HTMLElement>('.mt-cell:not([aria-disabled="true"])');
    (open(columnsRef.current[side]) ?? open(columnsRef.current.left))?.focus();
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
      focusAfterRef.current = cell.side;
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
            ref={(node) => {
              columnsRef.current.left = node;
            }}
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
            ref={(node) => {
              columnsRef.current.right = node;
            }}
          >
            {rightOrder.map((id) => {
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
