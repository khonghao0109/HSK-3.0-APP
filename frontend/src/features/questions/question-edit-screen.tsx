'use client';

import { useRouter } from 'next/navigation';

import { QuestionForm, type QuestionFormProps } from './question-form';
import type { QuestionFormValue } from './question-values';

/**
 * Cầu nối client cho trang sửa câu hỏi (pattern `exercise-edit-screen.tsx`):
 * lưu thành công gọi `router.refresh()` để tải lại dữ liệu server.
 */
export function QuestionEditScreen({
  initial,
  levels,
  tags,
  audio,
  image,
  submitPath,
  archived,
}: {
  initial: QuestionFormValue;
  levels: QuestionFormProps['levels'];
  tags: QuestionFormProps['tags'];
  audio: QuestionFormProps['audio'];
  image: QuestionFormProps['image'];
  submitPath: string;
  archived: boolean;
}) {
  const router = useRouter();
  return (
    <QuestionForm
      mode="edit"
      initial={initial}
      levels={levels}
      tags={tags}
      audio={audio}
      image={image}
      submitPath={submitPath}
      archived={archived}
      onSaved={() => router.refresh()}
    />
  );
}
