'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { levelLabel } from '@/features/learner-home/level-label';
import { ToastButton } from '@/features/learner-shell/learner-toast';
import {
  TOAST_COMING_SOON,
  TOAST_LOCKED,
} from '@/features/learner-shell/learner-toast-messages';

import type {
  LessonState,
  PathLesson,
  PathLevel,
} from './learning-path-contract';
import { PATH_LEVEL_CODES } from './path-level-codes';

const STATE_TEXT: Record<LessonState, string> = {
  done: ', đã hoàn thành',
  current: ', đang học',
  available: ', có thể học',
  locked: ', đã khoá',
};

const STATE_ICON: Partial<Record<LessonState, string>> = {
  done: 'check-circle',
  locked: 'lock-fill',
};

function tabId(code: string): string {
  return `path-tab-${code}`;
}

function LessonTile({ lesson }: { lesson: PathLesson }) {
  const icon = STATE_ICON[lesson.state];
  const locked = lesson.state === 'locked';
  return (
    <ToastButton
      className={`topic is-${lesson.state}`}
      message={locked ? TOAST_LOCKED : TOAST_COMING_SOON}
      aria-current={lesson.state === 'current' ? 'step' : undefined}
      aria-disabled={locked ? 'true' : undefined}
    >
      <span className="topic__no">{lesson.position}</span>
      {icon && (
        <svg className="icon topic__state" aria-hidden="true">
          <use href={`#i-${icon}`} />
        </svg>
      )}
      <span className="topic__art" aria-hidden="true">
        <svg className="icon">
          <use href="#i-book-open" />
        </svg>
      </span>
      <span className="topic__name">{lesson.title}</span>
      <span className="sr-only">{STATE_TEXT[lesson.state]}</span>
    </ToastButton>
  );
}

/**
 * Level tabs (Q19): always the seven codes, default to the goal level. Tab
 * changes are local state only; no network call.
 */
export function LearnerPathLevels({
  levels,
  initialCode,
}: {
  levels: PathLevel[];
  initialCode: string;
}) {
  const [selected, setSelected] = useState(() =>
    PATH_LEVEL_CODES.some((code) => code === initialCode)
      ? initialCode
      : PATH_LEVEL_CODES[0],
  );
  const listRef = useRef<HTMLDivElement>(null);

  // Bring the selected tab into the scrolling strip without scrolling the page.
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !tab) return;
    const listBox = list.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    if (tabBox.left < listBox.left || tabBox.right > listBox.right) {
      list.scrollLeft +=
        tabBox.left - listBox.left - (listBox.width - tabBox.width) / 2;
    }
  }, [selected]);

  function focusTab(code: string) {
    setSelected(code);
    listRef.current?.querySelector<HTMLElement>(`#${tabId(code)}`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = PATH_LEVEL_CODES.findIndex((code) => code === selected);
    const last = PATH_LEVEL_CODES.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    const code = next === null ? undefined : PATH_LEVEL_CODES[next];
    if (!code) return;
    event.preventDefault();
    focusTab(code);
  }

  const level = levels.find((item) => item.code === selected);
  const label = levelLabel(selected);
  const lessons = [...(level?.lessons ?? [])].sort(
    (a, b) => a.position - b.position,
  );

  return (
    <>
      <div
        ref={listRef}
        className="path-tabs"
        role="tablist"
        aria-label="Cấp độ HSK"
        onKeyDown={onKeyDown}
      >
        {PATH_LEVEL_CODES.map((code) => {
          const on = code === selected;
          return (
            <button
              key={code}
              id={tabId(code)}
              className="path-tab"
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="path-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => setSelected(code)}
            >
              {levelLabel(code)}
            </button>
          );
        })}
      </div>

      <section
        className="path-panel"
        id="path-panel"
        role="tabpanel"
        aria-labelledby="path-title"
        tabIndex={level && lessons.length > 0 ? undefined : 0}
      >
        <h1 className="path-title" id="path-title">
          {`Lộ trình ${label}`}
        </h1>
        {level && lessons.length > 0 ? (
          <>
            <p className="path-sub">
              {`Hoàn thành ${level.lessonCount} bài để nắm vững ${label}`}
            </p>
            <ol className="path-grid">
              {lessons.map((lesson) => (
                <li key={lesson.id}>
                  <LessonTile lesson={lesson} />
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="path-sub">{`${label} chưa mở.`}</p>
        )}
      </section>
    </>
  );
}
