'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

import { Icon } from '@/components/ui/icon';
import { ToastButton } from '@/features/learner-shell/learner-toast';

import {
  COURSE_LOCKED_TOAST,
  nextCourseLesson,
  VOLUME_LABEL,
  type CourseLesson,
  type CourseUnit,
} from './course-model';

function UnitState({ unit }: { unit: CourseUnit }) {
  const has = (state: CourseLesson['state']) =>
    unit.lessons.some((lesson) => lesson.state === state);
  if (
    unit.lessons.length > 0 &&
    unit.lessons.every((l) => l.state === 'done')
  ) {
    return (
      <span className="crs-unit__state is-done">
        <Icon name="check-circle" size={16} />
        Đã xong
      </span>
    );
  }
  if (has('current')) {
    return <span className="crs-unit__state is-current">Đang học</span>;
  }
  if (has('available')) {
    return (
      <span className="crs-unit__state">
        <Icon name="play" size={16} />
        {unit.lessons[0]?.state === 'available' ? 'Đã mở bài đầu' : 'Đã mở'}
      </span>
    );
  }
  return (
    <span className="crs-unit__state">
      <Icon name="lock" size={16} />
      Chưa mở
    </span>
  );
}

function LessonRow({ lesson }: { lesson: CourseLesson }) {
  const head = (
    <>
      <span className="crs-lesson__no">
        <span className="sr-only">Bài </span>
        {lesson.position}
      </span>
      <span className="crs-lesson__title">{lesson.title}</span>
    </>
  );
  if (lesson.state === 'locked') {
    return (
      <ToastButton
        className="crs-lesson is-locked"
        aria-disabled="true"
        message={COURSE_LOCKED_TOAST}
      >
        {head}
        <span className="crs-lesson__state">
          <Icon name="lock" size={16} />
          Chưa mở
        </span>
      </ToastButton>
    );
  }
  return (
    <Link
      className={`crs-lesson is-${lesson.state}`}
      href={`/learn/lessons/${lesson.id}`}
      aria-current={lesson.state === 'current' ? 'step' : undefined}
    >
      {head}
      <span className="crs-lesson__state">
        {lesson.state === 'done' && (
          <>
            <Icon name="check-circle" size={16} />
            Đã xong
          </>
        )}
        {lesson.state === 'current' &&
          `Đang học · ${Math.round(lesson.completionPercent)}%`}
        {lesson.state === 'available' && (
          <>
            <Icon name="play" size={16} />
            Đã mở
          </>
        )}
      </span>
    </Link>
  );
}

/** Units of a course detail: one disclosure button per unit (aria-expanded). */
export function CourseUnits({ units }: { units: CourseUnit[] }) {
  const ids = useId();
  const [open, setOpen] = useState<ReadonlySet<number>>(() => {
    // PO 24/11: only the current lesson's unit (else the next open one's).
    const next = nextCourseLesson({ units });
    return new Set(next ? [next.unitIndex] : []);
  });

  function toggle(index: number) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <ol className="crs-units">
      {units.map((unit, index) => {
        const bodyId = `${ids}-u${index}`;
        const expanded = open.has(index);
        const done = unit.lessons.filter((l) => l.state === 'done').length;
        const volume = unit.volume ? VOLUME_LABEL[unit.volume] : null;
        return (
          <li className="crs-unit" key={`${unit.orderIndex}-${index}`}>
            <button
              className="crs-unit__head"
              type="button"
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={() => toggle(index)}
            >
              <span>
                <span className="crs-unit__name">
                  {unit.title}
                  {volume && (
                    <span className="crs-vol">
                      <span lang="zh-Hans">{volume[0]}</span> {volume[1]}
                    </span>
                  )}
                </span>
                <span className="crs-unit__sub">
                  {`${unit.lessons.length} bài · ${done} đã xong`}
                </span>
              </span>
              <UnitState unit={unit} />
              <Icon name="chevron-down" className="crs-unit__chev" />
            </button>
            <div className="crs-unit__body" id={bodyId} hidden={!expanded}>
              <ol className="crs-lessons">
                {unit.lessons.map((lesson) => (
                  <li key={lesson.id}>
                    <LessonRow lesson={lesson} />
                  </li>
                ))}
              </ol>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
