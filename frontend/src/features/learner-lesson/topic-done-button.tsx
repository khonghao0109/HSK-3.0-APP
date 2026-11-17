'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Icon } from '@/components/ui/icon';

/**
 * M2.5f: marks one content topic learned through the existing complete BFF
 * (`POST /api/learner/topics/:id/complete`, Q58), then reloads the page data.
 */
export function TopicDoneButton({
  topicId,
  lessonId,
  done,
}: {
  topicId: number;
  lessonId: number;
  done: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle');

  if (done) {
    return (
      <p className="topic-done is-done">
        <Icon name="check-circle" />
        Đã học xong
      </p>
    );
  }

  async function markDone() {
    setState('saving');
    const response = await fetch(`/api/learner/topics/${topicId}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId }),
    }).catch(() => null);
    if (response?.ok) {
      setState('idle');
      router.refresh();
    } else {
      setState('failed');
    }
  }

  return (
    <div className="topic-done">
      <button
        type="button"
        className="btn btn--outline"
        onClick={markDone}
        disabled={state === 'saving'}
      >
        <Icon name="check-circle" />
        Đánh dấu đã học
      </button>
      {state === 'failed' && (
        <p className="topic-done__error" role="alert">
          Chưa lưu được. Bạn thử lại nhé.
        </p>
      )}
    </div>
  );
}
