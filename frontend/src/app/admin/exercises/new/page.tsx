import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { levelLabel } from '@/features/admin-shell/admin-labels';
import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { parseRouteId } from '@/features/content/content-values';
import {
  loadExerciseAudioOptions,
  loadExerciseLessonContext,
  loadExerciseLessonOptions,
} from '@/features/exercises/exercise-admin-service';
import { ExerciseCreateScreen } from '@/features/exercises/exercise-create-screen';
import type {
  ExerciseLessonOption,
  ExerciseMediaOption,
  ExerciseTopicOption,
} from '@/features/exercises/exercise-form-values';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../admin-exercise-form.css';

export const metadata: Metadata = { title: 'Tạo bài tập' };

export default async function ExerciseCreatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawLessonId = (await searchParams).lessonId;
  const raw = Array.isArray(rawLessonId) ? rawLessonId[0] : rawLessonId;
  // `?lessonId=` là nguồn đúng duy nhất cho bài học đã chọn (TL-18).
  const lessonId = raw === undefined ? null : parseRouteId(raw);
  if (raw !== undefined && lessonId === null) notFound();

  let lessons: ExerciseLessonOption[] = [];
  let topics: ExerciseTopicOption[] = [];
  let lessonTitle: string | null = null;
  let lessonArchived = false;
  let audio: ExerciseMediaOption[];
  try {
    const [audioOptions, lessonOptions] = await Promise.all([
      loadExerciseAudioOptions(),
      // shortcut: 100 bài đầu, khi > 100 bài thì chuyển sang ô tìm kiếm
      loadExerciseLessonOptions(),
    ]);
    audio = audioOptions;
    lessons = lessonOptions;
    if (lessonId !== null) {
      const context = await loadExerciseLessonContext(lessonId);
      topics = context.topics;
      lessonTitle = context.lesson.title;
      lessonArchived = context.lesson.status === 'archived';
    }
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401)
      redirectToSessionLogin();
    // Layouts do not re-render on client navigation, so the admin layout's
    // role check can be stale; the backend's per-request 403 is authoritative.
    if (error instanceof BackendRequestError && error.status === 403)
      redirect('/forbidden');
    if (error instanceof BackendRequestError && error.status === 404)
      notFound();
    throw error;
  }

  return (
    <div className="adm-page-stack">
      <nav className="adm-breadcrumb" aria-label="Đường dẫn">
        <Link href="/admin/exercises">Bài tập</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Tạo bài tập</span>
      </nav>
      <header className="adm-page-head">
        <div>
          <h1>Tạo bài tập</h1>
          <p>
            {lessonTitle
              ? `Bài học: ${lessonTitle}`
              : 'Bài tập mới tạo ở trạng thái bản nháp, kèm bản sửa đầu tiên.'}
          </p>
        </div>
      </header>
      {lessonArchived ? (
        <section className="adm-card adm-panel" aria-live="polite">
          <p className="adm-muted">
            Bài học đã lưu trữ, không thêm bài tập được.
          </p>
        </section>
      ) : lessonId === null ? (
        <section
          className="adm-card adm-panel"
          aria-labelledby="exercise-pick-lesson-title"
        >
          <div className="adm-panel__head">
            <h2 className="adm-panel__title" id="exercise-pick-lesson-title">
              Chọn bài học
            </h2>
          </div>
          <form
            className="adm-page-stack"
            action="/admin/exercises/new"
            method="get"
          >
            <div className="adm-field">
              <label className="adm-field__label" htmlFor="exercise-lesson">
                Bài học
              </label>
              <select
                className="adm-input"
                id="exercise-lesson"
                name="lessonId"
                defaultValue=""
                required
              >
                <option value="" disabled>
                  Chọn bài học
                </option>
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {levelLabel(lesson.levelCode)} · {lesson.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="adm-page-head__actions">
              <button className="adm-btn adm-btn--primary" type="submit">
                Tiếp tục
              </button>
            </div>
          </form>
        </section>
      ) : (
        <ExerciseCreateScreen
          lessons={lessons}
          topics={topics}
          audio={audio}
          initialLessonId={lessonId}
          initialLessonTitle={lessonTitle}
          submitPath="/api/admin/exercises"
        />
      )}
    </div>
  );
}
