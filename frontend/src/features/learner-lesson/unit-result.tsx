'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Icon } from '@/components/ui/icon';

type Props = {
  lessonId: number;
  topicId: number;
  /** "Từ vựng 2 · Gia đình", "Ngữ pháp · Gia đình" */
  title: string;
  lessonHref: string;
  /** Next unit after this one, when it is open (mẫu "Đơn vị tiếp"). */
  nextHref: string | null;
  /** The unit's own summary, under the title. */
  children?: ReactNode;
  /** The unit's own alerts, after the progress one. */
  alerts?: ReactNode;
  /** The unit's own buttons, after Đơn vị tiếp. */
  actions?: ReactNode;
};

/**
 * mẫu unit-complete, shared by every unit (Pha C, Pha D): marks the topic
 * done once (start the lesson, then complete the topic), no medal (N8),
 * no XP (Q59), no confetti (Q340 M4).
 */
export function UnitResult({
  lessonId,
  topicId,
  title,
  lessonHref,
  nextHref,
  children,
  alerts,
  actions,
}: Props) {
  const router = useRouter();
  const [progress, setProgress] = useState<'saving' | 'saved' | 'failed'>(
    'saving',
  );
  const sent = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // The result replaces the flow: move focus to its title.
  useEffect(() => titleRef.current?.focus(), []);

  const markDone = useCallback(async () => {
    setProgress('saving');
    const post = (url: string, body: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }).catch(() => null);
    // A topic completes only in a started lesson; the BFF answers 200 for a
    // lesson that is already started.
    const started = await post(`/api/learner/lessons/${lessonId}/start`, '{}');
    await started?.text().catch(() => '');
    const response = started?.ok
      ? await post(
          `/api/learner/topics/${topicId}/complete`,
          JSON.stringify({ lessonId }),
        )
      : started;
    if (response?.status === 401 || response?.status === 403) {
      router.replace('/sign-in');
      return;
    }
    setProgress(response?.ok ? 'saved' : 'failed');
  }, [lessonId, topicId, router]);

  // Once, when the result shows (Strict Mode runs effects twice).
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void markDone();
  }, [markDone]);

  // Pha C debt 3a: leaving while the topic is saving would show the unit as
  // not done on the units screen, so the links wait for the answer.
  const saving = progress === 'saving';
  const wait = saving
    ? {
        'aria-disabled': true as const,
        onClick: (event: MouseEvent) => event.preventDefault(),
      }
    : {};

  return (
    <>
      <header className="done-brand w-only">
        <Link className="done-brand__link" href="/learn">
          <span className="done-brand__mark" aria-hidden="true">
            汉
          </span>
          <span className="done-brand__name">Hán Lộ</span>
        </Link>
      </header>
      <main className="done-main lu-done">
        <section
          className="done-card"
          aria-labelledby="done-title"
          aria-busy={saving || undefined}
        >
          <div className="done-hero">
            <p className="done-kicker">
              <span className="m-only">Bạn đã hoàn thành đơn vị học</span>
              <span className="w-only">Bạn đã hoàn thành đơn vị</span>
            </p>
            <h1
              className="done-title"
              id="done-title"
              ref={titleRef}
              tabIndex={-1}
            >
              {title}
            </h1>
          </div>

          {children}

          {progress === 'failed' && (
            <p className="ex-error lu-done__error" role="alert">
              Chưa lưu được tiến độ.{' '}
              <button
                className="lu-done__retry"
                type="button"
                onClick={() => void markDone()}
              >
                Thử lại
              </button>
            </p>
          )}
          {alerts}

          <div className="done-actions">
            <Link
              className="done-btn done-btn--light"
              href={lessonHref}
              {...wait}
            >
              <Icon name="arrow-left" />
              Về bài
            </Link>
            {nextHref && (
              <Link
                className="done-btn done-btn--primary"
                href={nextHref}
                {...wait}
              >
                Đơn vị tiếp
                <Icon name="arrow-right" />
              </Link>
            )}
            {actions}
          </div>
        </section>
      </main>
    </>
  );
}
