'use client';

import { useEffect, useRef, useState } from 'react';

type Grant = { src: string; expiresAtMs: number };

const PREVIEWABLE_MIME = {
  image: ['image/jpeg', 'image/png'],
  audio: ['audio/mpeg', 'audio/wav'],
} as const;

export const MEDIA_PREVIEW_MESSAGES = {
  unavailable:
    'Không xem trước được: chỉ media sẵn sàng, đang dùng, định dạng JPG/PNG/MP3/WAV.',
  failed: 'Không tải được bản xem trước.',
  expired: 'Liên kết nghe thử đã hết hạn. Bấm Nghe thử lại.',
  listen: 'Nghe thử',
  loading: 'Đang tải xem trước…',
} as const;

/** TL-55: chỉ media ready + active, ảnh JPG/PNG hoặc audio MP3/WAV. */
export function previewKind(asset: {
  type: string;
  mimeType: string | null;
  processingStatus: string;
  lifecycle: string;
}): 'image' | 'audio' | null {
  if (asset.processingStatus !== 'ready' || asset.lifecycle !== 'active') {
    return null;
  }
  if (asset.type !== 'image' && asset.type !== 'audio') return null;
  const allowed: readonly string[] = PREVIEWABLE_MIME[asset.type];
  return asset.mimeType !== null && allowed.includes(asset.mimeType)
    ? asset.type
    : null;
}

async function requestGrant(mediaId: number): Promise<Grant | null> {
  try {
    const response = await fetch(`/api/admin/media/${mediaId}/access`, {
      credentials: 'same-origin',
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status !== 200 || typeof body !== 'object' || body === null) {
      return null;
    }
    const data: unknown = Reflect.get(body, 'data');
    if (typeof data !== 'object' || data === null) return null;
    const src: unknown = Reflect.get(data, 'src');
    const expiresAt: unknown = Reflect.get(data, 'expiresAt');
    if (
      typeof src !== 'string' ||
      !src.startsWith(`/api/admin/media/${mediaId}/content?`) ||
      typeof expiresAt !== 'string'
    ) {
      return null;
    }
    const expiresAtMs = Date.parse(expiresAt);
    return Number.isFinite(expiresAtMs) ? { src, expiresAtMs } : null;
  } catch {
    return null;
  }
}

function ImagePreview({
  mediaId,
  filename,
}: {
  mediaId: number;
  filename: string;
}) {
  const [grant, setGrant] = useState<Grant | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void requestGrant(mediaId).then((next) => {
      if (!active) return;
      if (next) setGrant(next);
      else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [mediaId]);

  if (failed)
    return <p className="adm-muted">{MEDIA_PREVIEW_MESSAGES.failed}</p>;
  if (!grant)
    return <p className="adm-muted">{MEDIA_PREVIEW_MESSAGES.loading}</p>;
  return (
    <div className="adm-media-preview__frame">
      <img
        src={grant.src}
        alt={`Xem trước ${filename}`}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function AudioPreview({
  mediaId,
  filename,
}: {
  mediaId: number;
  filename: string;
}) {
  const [grant, setGrant] = useState<Grant | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const focusAudio = useRef(false);

  useEffect(() => {
    if (focusAudio.current && audioRef.current) {
      focusAudio.current = false;
      audioRef.current.focus();
    }
    if (!refocus.current || pending) return;
    refocus.current = false;
    buttonRef.current?.focus();
  });

  // TL-55: the grant's own expiry, not a fixed TTL, ends the player.
  useEffect(() => {
    if (!grant) return;
    const timer = setTimeout(
      () => {
        // N1: only reclaim focus the user has not moved elsewhere.
        const active = document.activeElement;
        refocus.current =
          active === document.body ||
          (active !== null && Boolean(blockRef.current?.contains(active)));
        setGrant(null);
        setMessage(MEDIA_PREVIEW_MESSAGES.expired);
      },
      Math.max(0, grant.expiresAtMs - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [grant]);

  function expire() {
    refocus.current = true;
    setGrant(null);
    setMessage(MEDIA_PREVIEW_MESSAGES.expired);
  }

  async function listen() {
    const fromButton = document.activeElement === buttonRef.current;
    setPending(true);
    setMessage(null);
    const next = await requestGrant(mediaId);
    setPending(false);
    if (next) {
      focusAudio.current = fromButton;
      setGrant(next);
    } else {
      refocus.current = true;
      setMessage(MEDIA_PREVIEW_MESSAGES.failed);
    }
  }

  return (
    <div ref={blockRef} className="adm-media-preview__audio">
      {grant ? (
        <audio
          ref={audioRef}
          // V2: focusable in every engine so focus can land on the player.
          tabIndex={0}
          controls
          preload="none"
          src={grant.src}
          aria-label={`Nghe thử ${filename}`}
          onError={expire}
        />
      ) : (
        <button
          ref={buttonRef}
          className="adm-btn adm-btn--outline"
          type="button"
          disabled={pending}
          onClick={() => void listen()}
        >
          {MEDIA_PREVIEW_MESSAGES.listen}
        </button>
      )}
      <p className="adm-muted" aria-live="polite">
        {message}
      </p>
    </div>
  );
}

export function MediaPreview({
  asset,
}: {
  asset: {
    id: number;
    filename: string | null;
    type: string;
    mimeType: string | null;
    processingStatus: string;
    lifecycle: string;
  };
}) {
  const kind = previewKind(asset);
  return (
    <section
      className="adm-card adm-panel"
      aria-labelledby="media-preview-title"
    >
      <div className="adm-panel__head">
        <h2 className="adm-panel__title" id="media-preview-title">
          Xem trước
        </h2>
      </div>
      <div className="adm-media-preview">
        {kind === 'image' ? (
          <ImagePreview
            mediaId={asset.id}
            filename={asset.filename ?? `Media ${asset.id}`}
          />
        ) : kind === 'audio' ? (
          <AudioPreview
            mediaId={asset.id}
            filename={asset.filename ?? `Media ${asset.id}`}
          />
        ) : (
          <p className="adm-muted">{MEDIA_PREVIEW_MESSAGES.unavailable}</p>
        )}
      </div>
    </section>
  );
}
