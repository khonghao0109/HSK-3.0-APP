'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';

import { useLearnerToast } from '@/features/learner-shell/learner-toast';

import { COURSE_ACTION_FAILED, courseCurrentToast } from './course-model';
import {
  createCourseTransport,
  type CourseTransport,
} from './course-transport';

/** "Học khoá này" on a course detail: one `PUT /current-course` (PO 24/11). */
export function CourseMakeCurrent({
  code,
  title,
  transport,
}: {
  code: string;
  title: string;
  transport?: Pick<CourseTransport, 'setCurrent'>;
}) {
  const router = useRouter();
  const showToast = useLearnerToast();
  const writes = useMemo(
    () => transport ?? createCourseTransport(),
    [transport],
  );
  const [busy, setBusy] = useState(false);
  // State lags a fast double click; the ref keeps it to one PUT.
  const sending = useRef(false);

  async function makeCurrent() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    const result = await writes.setCurrent(code);
    if (!result.ok) {
      sending.current = false;
      setBusy(false);
      if (result.status === 401) router.push('/sign-in');
      else showToast(COURSE_ACTION_FAILED, 'alert');
      return;
    }
    showToast(courseCurrentToast(title));
    router.refresh();
  }

  return (
    <button
      className="btn btn--primary"
      type="button"
      disabled={busy}
      onClick={() => void makeCurrent()}
    >
      Học khoá này
    </button>
  );
}
