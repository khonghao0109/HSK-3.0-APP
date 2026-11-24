'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Icon } from '@/components/ui/icon';
import { useLearnerToast } from '@/features/learner-shell/learner-toast';

import { CourseMeta, CourseProgress } from './course-badges';
import {
  COURSE_ACTION_FAILED,
  COURSE_LEAVE_TOAST,
  courseCurrentToast,
  courseFollowToast,
  courseLeaveText,
  courseLeaveTitle,
  type CourseSummary,
} from './course-model';
import {
  createCourseTransport,
  type CourseCall,
  type CourseTransport,
} from './course-transport';

type Writes = Pick<CourseTransport, 'enroll' | 'leave' | 'setCurrent'>;

/**
 * "Khoá học" list (mẫu web/courses.html, mobile/courses.html). Writes go
 * through the BFF; a successful "Học khoá này" also refreshes the server
 * page so "Học tiếp" points at the new current course.
 */
export function CourseList({
  courses,
  continueHref,
  transport,
}: {
  courses: CourseSummary[];
  /** Lesson "Học tiếp" opens for the current course, when there is one. */
  continueHref: string | null;
  transport?: Writes;
}) {
  const router = useRouter();
  const showToast = useLearnerToast();
  const writes = useMemo(
    () => transport ?? createCourseTransport(),
    [transport],
  );
  const [items, setItems] = useState(courses);
  const [busy, setBusy] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<CourseSummary | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const focusCode = useRef<string | null>(null);
  // State lags a fast double click; the ref keeps it to one request.
  const sending = useRef(false);
  const ids = useId();

  // A server refresh (after "Học khoá này") hands down a new list.
  const [source, setSource] = useState(courses);
  if (source !== courses) {
    setSource(courses);
    setItems(courses);
  }

  // Keep focus on the card the learner acted on once its buttons change.
  useEffect(() => {
    const code = focusCode.current;
    if (code === null) return;
    focusCode.current = null;
    document
      .getElementById(`${ids}-${code}`)
      ?.closest('article')
      ?.querySelector<HTMLElement>('.crs-actions a, .crs-actions button')
      ?.focus();
  }, [items, ids]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (leaving && !dialog.open) dialog.showModal();
    if (!leaving && dialog.open) dialog.close();
  }, [leaving]);

  async function run(
    code: string,
    call: () => Promise<CourseCall<unknown>>,
    apply: (list: CourseSummary[]) => CourseSummary[],
    message: string,
  ): Promise<boolean> {
    if (sending.current) return false;
    sending.current = true;
    setBusy(code);
    const result = await call();
    sending.current = false;
    setBusy(null);
    if (!result.ok) {
      if (result.status === 401) router.push('/sign-in');
      else showToast(COURSE_ACTION_FAILED, 'alert');
      return false;
    }
    focusCode.current = code;
    setItems(apply);
    showToast(message);
    return true;
  }

  function makeCurrent(course: CourseSummary) {
    void run(
      course.code,
      () => writes.setCurrent(course.code),
      (list) =>
        list.map((item) => ({
          ...item,
          isCurrent: item.code === course.code,
          enrolled: item.enrolled || item.code === course.code,
        })),
      courseCurrentToast(course.title),
    ).then((done) => {
      if (done) router.refresh();
    });
  }

  function follow(course: CourseSummary) {
    void run(
      course.code,
      () => writes.enroll(course.code),
      (list) =>
        list.map((item) =>
          item.code === course.code ? { ...item, enrolled: true } : item,
        ),
      courseFollowToast(course.title),
    );
  }

  function confirmLeave() {
    const course = leaving;
    if (!course) return;
    // The dialog closes onto its opener; on success focus moves on to the card.
    setLeaving(null);
    void run(
      course.code,
      () => writes.leave(course.code),
      (list) =>
        list.map((item) =>
          item.code === course.code ? { ...item, enrolled: false } : item,
        ),
      COURSE_LEAVE_TOAST,
    );
  }

  if (items.length === 0) {
    return (
      <section className="crs-state" aria-labelledby={`${ids}-empty`}>
        <span className="crs-state__art" aria-hidden="true">
          <Icon name="book" />
        </span>
        <h2 id={`${ids}-empty`}>Chưa có khoá học nào</h2>
        <p>
          Khoá học sẽ hiện ở đây khi được mở. Bạn vẫn học được bài theo lộ trình
          hiện có.
        </p>
        <Link className="btn btn--primary" href="/learn">
          Về Trang chủ
        </Link>
      </section>
    );
  }

  return (
    <>
      <ul className="crs-list" aria-label="Danh sách khoá học">
        {items.map((course) => {
          const titleId = `${ids}-${course.code}`;
          const view = (
            <Link
              className="crs-link"
              href={`/learn/courses/${course.code}`}
              aria-label={`Xem khoá ${course.title}`}
            >
              <span>
                Xem<span className="w-only"> khoá</span>
              </span>
              <Icon name="chevron-right" />
            </Link>
          );
          const disabled = busy !== null;
          return (
            <li key={course.code}>
              <article
                className={`crs-card${course.isCurrent ? ' is-current' : ''}`}
                aria-labelledby={titleId}
              >
                <CourseMeta course={course} />
                <h2 className="crs-card__title" id={titleId}>
                  {course.title}
                </h2>
                {course.description && (
                  <p className="crs-card__desc">{course.description}</p>
                )}
                <CourseProgress
                  label={`Tiến độ ${course.title}`}
                  progress={course.progress}
                />
                <div className="crs-actions">
                  {course.isCurrent ? (
                    <>
                      <Link
                        className="btn btn--primary"
                        href={continueHref ?? `/learn/courses/${course.code}`}
                      >
                        Học tiếp
                        <Icon name="arrow-right" />
                      </Link>
                      {view}
                    </>
                  ) : (
                    <>
                      <button
                        className="btn btn--primary"
                        type="button"
                        disabled={disabled}
                        onClick={() => makeCurrent(course)}
                      >
                        Học khoá này
                      </button>
                      {!course.enrolled && (
                        <button
                          className="btn btn--outline"
                          type="button"
                          disabled={disabled}
                          onClick={() => follow(course)}
                        >
                          <Icon name="plus" />
                          Theo dõi
                        </button>
                      )}
                      {view}
                      {course.enrolled && (
                        <button
                          className="crs-ghost"
                          type="button"
                          aria-label={`Bỏ theo dõi ${course.title}`}
                          disabled={disabled}
                          onClick={(event) => {
                            openerRef.current = event.currentTarget;
                            setLeaving(course);
                          }}
                        >
                          Bỏ theo dõi
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      <dialog
        ref={dialogRef}
        className="ext-dialog crs-dialog"
        aria-labelledby={`${ids}-leave-title`}
        aria-describedby={`${ids}-leave-text`}
        onClose={() => {
          setLeaving(null);
          openerRef.current?.focus();
          openerRef.current = null;
        }}
      >
        <h2 id={`${ids}-leave-title`}>
          {leaving ? courseLeaveTitle(leaving.title) : ''}
        </h2>
        <p className="muted" id={`${ids}-leave-text`}>
          {leaving
            ? courseLeaveText(
                leaving.progress.completedLessons,
                leaving.progress.totalLessons,
              )
            : ''}
        </p>
        <div className="ext-dialog__actions">
          <button
            className="btn btn--outline"
            type="button"
            onClick={() => setLeaving(null)}
          >
            Giữ lại
          </button>
          <button
            className="btn btn--danger crs-danger"
            type="button"
            onClick={confirmLeave}
          >
            Bỏ theo dõi
          </button>
        </div>
      </dialog>
    </>
  );
}
