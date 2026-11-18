'use client';

import { useEffect, useState } from 'react';

/**
 * Ảnh bìa bài học / ảnh từ (Q350). Lấy grant qua BFF rồi gắn `src`; lỗi thì
 * không hiện gì, khung giữ icon mặc định của chỗ đặt. Alt tiếng Việt từ media.
 */
export function LessonImage({
  mediaId,
  altText,
  className,
}: {
  mediaId: number;
  altText: string | null;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const prefix = `/api/learner/media/${mediaId}/content?`;
    void fetch(`/api/learner/media/${mediaId}/access`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const data: unknown =
          typeof body === 'object' && body !== null
            ? Reflect.get(body, 'data')
            : null;
        const next: unknown =
          typeof data === 'object' && data !== null
            ? Reflect.get(data, 'src')
            : null;
        if (active && typeof next === 'string' && next.startsWith(prefix)) {
          setSrc(next);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [mediaId]);

  if (src === null) return null;
  return <img className={className} src={src} alt={altText ?? ''} />;
}
