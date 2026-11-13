'use client';

import { useRouter } from 'next/navigation';

import { ExerciseForm } from './exercise-form';
import type { ExerciseFormCreateProps } from './exercise-form-values';

/**
 * Cầu nối client cho trang tạo bài tập (M5.1b1, TL-18): page là Server
 * Component nên không truyền được `onSaved`; wrapper nhỏ này gắn `useRouter`
 * và điều hướng tới trang sửa của bài vừa tạo.
 */
export function ExerciseCreateScreen({
  lessons,
  topics,
  audio,
  initialLessonId,
  initialLessonTitle,
  submitPath,
}: Omit<ExerciseFormCreateProps, 'mode' | 'onSaved'>) {
  const router = useRouter();
  return (
    <ExerciseForm
      mode="create"
      lessons={lessons}
      topics={topics}
      audio={audio}
      initialLessonId={initialLessonId ?? null}
      initialLessonTitle={initialLessonTitle ?? null}
      submitPath={submitPath}
      onSaved={(exerciseId) => router.push(`/admin/exercises/${exerciseId}`)}
    />
  );
}
