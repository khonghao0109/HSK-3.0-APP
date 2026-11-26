'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/ui/icon';
import { percentClass } from '@/features/learner-home/percent';

import { DialogueLines, GrammarPointBody, ZhText } from './topic-blocks-view';
import type { GrammarPointBlock, KeyTextBlock } from './topic-content';
import { UnitResult } from './unit-result';

type UnitProps = {
  lessonId: number;
  topicId: number;
  /** "Ngữ pháp · Gia đình" */
  title: string;
  lessonHref: string;
  /** Next unit after this one, when it is open (mẫu "Đơn vị tiếp"). */
  nextHref: string | null;
};

/** The frame of the unit screens (Pha C `.lu-flow`), one step of `total`. */
function UnitFrame({
  title,
  lessonHref,
  shown,
  total,
  mobileBack,
  children,
  footer,
}: {
  title: string;
  lessonHref: string;
  shown: number;
  total: number;
  /** mẫu key-text: a back chevron and no step count on mobile. */
  mobileBack: boolean;
  children: ReactNode;
  footer: ReactNode;
}) {
  const progress = (className: string) => (
    <div
      className={className}
      role="progressbar"
      aria-label="Tiến độ đơn vị"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={shown}
    >
      <span className={percentClass((shown / total) * 100)} />
    </div>
  );
  return (
    <div className="ex lu-flow">
      <header className="m02-head m02-bar ex-bar">
        {mobileBack && (
          <Link
            className="icon-btn m-only"
            href={lessonHref}
            aria-label="Quay lại bài học"
          >
            <Icon name="chevron-left" />
          </Link>
        )}
        <Link
          className={mobileBack ? 'icon-btn w-only' : 'icon-btn'}
          href={lessonHref}
          aria-label="Thoát về bài học"
        >
          <Icon name="x" />
        </Link>
        <div className="ex-track">
          <h1 className="m02-bar__title">{title}</h1>
          {progress('progress ex-progress ex-progress--web w-only')}
        </div>
        <p
          className={mobileBack ? 'm02-bar__count w-only' : 'm02-bar__count'}
          aria-label={`Bước ${shown} trên ${total}`}
        >
          {`${shown}/${total}`}
        </p>
      </header>
      <main className="m02-sheet ex-body">
        {!mobileBack && (
          <div className="lu-progress m-only">
            {progress('progress')}
            <span className="lu-progress__count" aria-hidden="true">
              {`${shown}/${total}`}
            </span>
          </div>
        )}
        {children}
      </main>
      <footer className="ex-foot">
        <div className="lu-foot">
          <Link className="btn btn--outline" href={lessonHref}>
            Về bài
          </Link>
          {footer}
        </div>
      </footer>
    </div>
  );
}

/**
 * Pha D (mẫu grammar-point): one card per grammar point. The Đã hiểu switch
 * is the learner's own note, kept on the screen only (TL 3); the Đã hiểu
 * button goes on, and after the last card the unit is done.
 */
export function GrammarUnitFlow({
  points,
  ...unit
}: UnitProps & { points: readonly GrammarPointBlock[] }) {
  const [index, setIndex] = useState(0);
  const [understood, setUnderstood] = useState<Record<number, boolean>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    // Focus follows the card after a click, not on first render.
    if (moved.current) headingRef.current?.focus();
  }, [index]);

  const point = points[index];
  if (!point) return <UnitResult {...unit} />;

  const total = points.length;
  const headingId = `gp-${index}`;
  return (
    <UnitFrame
      title={unit.title}
      lessonHref={unit.lessonHref}
      shown={index + 1}
      total={total}
      mobileBack={false}
      footer={
        <button
          className="btn btn--primary"
          type="button"
          onClick={() => {
            moved.current = true;
            setIndex(index + 1);
          }}
        >
          Đã hiểu
          <Icon name="check" />
        </button>
      }
    >
      <section key={index} className="lu-card" aria-labelledby={headingId}>
        <p className="lu-sub">{`Điểm ${index + 1} trên ${total}`}</p>
        <GrammarPointBody
          block={point}
          headingId={headingId}
          headingRef={headingRef}
        />
        <div className="uxa-understand">
          <p className="uxa-understand__label">Đã hiểu điểm ngữ pháp này</p>
          <label className="switch">
            <input
              type="checkbox"
              aria-label={`Đã hiểu ${point.title}`}
              checked={understood[index] ?? false}
              onChange={(event) =>
                setUnderstood({ ...understood, [index]: event.target.checked })
              }
            />
            <span />
          </label>
        </div>
      </section>
    </UnitFrame>
  );
}

/** Pha D (mẫu key-text): the conversation, then Hoàn thành. No pinyin toggle. */
export function KeyTextUnitFlow({
  heading,
  description,
  blocks,
  ...unit
}: UnitProps & {
  heading: string;
  description: string | null;
  /** Dialogue and narrative text blocks, in `Topic.content` order. */
  blocks: readonly KeyTextBlock[];
}) {
  const [done, setDone] = useState(false);
  if (done) return <UnitResult {...unit} />;
  return (
    <UnitFrame
      title={unit.title}
      lessonHref={unit.lessonHref}
      shown={1}
      total={1}
      mobileBack
      footer={
        <button
          className="btn btn--primary"
          type="button"
          onClick={() => setDone(true)}
        >
          Hoàn thành
          <Icon name="check" />
        </button>
      }
    >
      <h2 className="uxa-h2">{heading}</h2>
      {description && <p className="lu-sub">{description}</p>}
      {blocks.map((block, index) =>
        block.kind === 'text' ? (
          <p key={index} className="lu-text">
            <ZhText text={block.value} />
          </p>
        ) : (
          <DialogueLines key={index} lines={block.lines} audio={block.audio} />
        ),
      )}
    </UnitFrame>
  );
}
