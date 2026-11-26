'use client';

import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/ui/icon';

import { requestGrant } from './listening-exercise';

export const WORD_AUDIO_LABEL = 'Nghe phát âm';
export const WORD_AUDIO_FAILED = 'Không phát được âm thanh.';

/**
 * M2.13c2: nút loa của một từ (thẻ Từ vựng, chi tiết từ điển); M2.13d: cả bài
 * khoá (`label`). Không có audio
 * thì không hiện. Grant xin khi bấm (TTL ngắn, cùng BFF với bài nghe), rồi
 * phát bằng `<audio preload="none">`; lỗi hiện thành chữ trong vùng `status`
 * luôn có sẵn (rỗng khi chưa lỗi) để trình đọc màn hình đọc được.
 */
export function WordAudioButton({
  audio,
  className = 'icon-btn',
  ...name
}: {
  audio: { mediaId: number } | null;
  /** Replaces the default `icon-btn` (M2.13d: `lu-say` of a key text). */
  className?: string;
} & ({ hanzi: string } | { label: string })) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = audioRef.current;
    return () => element?.pause();
  }, []);

  if (audio === null) return null;

  const listen = () => {
    setFailed(false);
    void requestGrant(audio.mediaId).then((grant) => {
      const element = audioRef.current;
      if (!grant || !element) {
        setFailed(true);
        return;
      }
      element.src = grant.src;
      element.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setFailed(true);
      });
    });
  };

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={
          'label' in name ? name.label : `${WORD_AUDIO_LABEL} ${name.hanzi}`
        }
        onClick={listen}
      >
        <Icon name="volume" />
      </button>
      <audio ref={audioRef} preload="none" onError={() => setFailed(true)} />
      <span role="status">
        {failed && <span className="ex-error">{WORD_AUDIO_FAILED}</span>}
      </span>
    </>
  );
}
