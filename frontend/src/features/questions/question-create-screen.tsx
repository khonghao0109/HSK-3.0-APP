'use client';

import { useRouter } from 'next/navigation';

import { QuestionForm, type QuestionFormProps } from './question-form';
import type { QuestionFormValue } from './question-values';

/**
 * Cầu nối client cho trang tạo câu hỏi (pattern `exercise-create-screen.tsx`):
 * page là Server Component nên wrapper gắn `useRouter` và mở trang chi tiết
 * của câu vừa tạo.
 */
export function QuestionCreateScreen({
  initial,
  levels,
  tags,
  audio,
  image,
  submitPath,
}: {
  initial: QuestionFormValue;
  levels: QuestionFormProps['levels'];
  tags: QuestionFormProps['tags'];
  audio: QuestionFormProps['audio'];
  image: QuestionFormProps['image'];
  submitPath: string;
}) {
  const router = useRouter();
  return (
    <QuestionForm
      mode="create"
      initial={initial}
      levels={levels}
      tags={tags}
      audio={audio}
      image={image}
      submitPath={submitPath}
      onSaved={(questionId) => {
        router.push(
          questionId === undefined
            ? '/admin/questions'
            : `/admin/questions/${questionId}`,
        );
      }}
    />
  );
}
