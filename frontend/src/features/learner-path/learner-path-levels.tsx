'use client';

import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { levelLabel } from '@/features/learner-home/level-label';
import { percentClass, wholePercent } from '@/features/learner-home/percent';
import { ToastButton } from '@/features/learner-shell/learner-toast';
import { TOAST_LOCKED } from '@/features/learner-shell/learner-toast-messages';

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

// Visible state line of the web tile (mẫu web/path.html); the sr-only
// STATE_TEXT already names the state, so this one is aria-hidden.
const STATE_LABEL: Record<Exclude<LessonState, 'current'>, string> = {
  done: 'Đã xong',
  available: 'Có thể học',
  locked: 'Chưa mở',
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
  const body = (
    <>
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
      <span className="topic__label w-only" aria-hidden="true">
        {lesson.state === 'current' ? (
          `Đang học · ${wholePercent(lesson.completionPercent)}%`
        ) : (
          <>
            {icon && (
              <svg className="icon">
                <use href={`#i-${lesson.state === 'locked' ? 'lock' : icon}`} />
              </svg>
            )}
            {STATE_LABEL[lesson.state]}
          </>
        )}
      </span>
      {lesson.state === 'current' && (
        <span className="topic__bar w-only" aria-hidden="true">
          <span className={percentClass(lesson.completionPercent)} />
        </span>
      )}
    </>
  );

  // Q44: a locked lesson only explains why; open ones go to the lesson page.
  if (lesson.state === 'locked') {
    return (
      <ToastButton
        className="topic is-locked"
        message={TOAST_LOCKED}
        aria-disabled="true"
      >
        {body}
      </ToastButton>
    );
  }
  return (
    <Link
      className={`topic is-${lesson.state}`}
      href={`/learn/lessons/${lesson.id}`}
      aria-current={lesson.state === 'current' ? 'step' : undefined}
    >
      {body}
    </Link>
  );
}

/**
 * Level tabs (Q19): always the seven codes, default to the goal level. Tab
 * changes are local state only; no network call.
 *
 * `midCard` is the M2.10d F4 copy of the "Bài tiếp theo" card for the
 * 1024–1279px layout. It is rendered between the tabs and the panel — right
 * above the lesson grid, where the eye sees it — so the DOM and the visual
 * order match (the ≥ 1280px copy stays after `main`).
 */
export function LearnerPathLevels({
  levels,
  initialCode,
  midCard = null,
}: {
  levels: PathLevel[];
  initialCode: string;
  midCard?: ReactNode;
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

      {midCard}

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
      {level && lessons.length > 0 && (
        <PathSummary level={level} lessons={lessons} label={label} />
      )}
    </>
  );
}

/** Web "Tiến độ" card of the selected level (mẫu web/path.html). */
function PathSummary({
  level,
  lessons,
  label,
}: {
  level: PathLevel;
  lessons: PathLesson[];
  label: string;
}) {
  const count = (state: LessonState) =>
    lessons.filter((lesson) => lesson.state === state).length;
  const rows: Array<[string, string, number]> = [
    ['check-circle', 'Đã xong', count('done')],
    ['book-open', 'Đang học', count('current')],
    ['lock', 'Chưa mở', count('locked')],
  ];
  const available = count('available');
  if (available > 0) rows.splice(2, 0, ['book-open', 'Có thể học', available]);
  const share =
    level.lessonCount > 0
      ? (level.completedCount / level.lessonCount) * 100
      : 0;

  return (
    <section className="path-sum w-only" aria-labelledby="path-sum-title">
      <h2 className="path-sum__title" id="path-sum-title">
        {`Tiến độ ${label}`}
      </h2>
      <p className="path-sum__big">
        <b>{level.completedCount}</b>
        {`/${level.lessonCount} bài đã xong`}
      </p>
      <span className="path-sum__bar" aria-hidden="true">
        <span className={percentClass(share)} />
      </span>
      <ul className="path-sum__legend">
        {rows.map(([icon, text, value]) => (
          <li key={text}>
            <svg className="icon" aria-hidden="true">
              <use href={`#i-${icon}`} />
            </svg>
            {`${text}: `}
            <b>{value}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}
