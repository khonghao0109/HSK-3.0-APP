'use client';

import { useRouter } from 'next/navigation';

import { ExerciseForm } from './exercise-form';
import type { ExerciseFormEditProps } from './exercise-form-values';

/**
 * Cầu nối client cho trang sửa bài tập (M5.1b1, TL-18): `onSaved` phải là
 * client callback, nên wrapper nhỏ này gắn `router.refresh()` để tải lại dữ
 * liệu sau khi tạo bản sửa mới.
 */
export function ExerciseEditScreen({
  initial,
  lessonTitle,
  topicTitle,
  archived,
  audio,
  submitPath,
}: Omit<ExerciseFormEditProps, 'mode' | 'onSaved'>) {
  const router = useRouter();
  return (
    <ExerciseForm
      mode="edit"
      initial={initial}
      lessonTitle={lessonTitle}
      topicTitle={topicTitle}
      archived={archived}
      audio={audio}
      submitPath={submitPath}
      onSaved={() => router.refresh()}
    />
  );
}
