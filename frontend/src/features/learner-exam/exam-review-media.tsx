'use client';

import { useEffect, useRef, useState } from 'react';

import { reviewMediaLabel } from './exam-review-model';

/**
 * M4.5 B2b: the only client island on the review page. The server renders the
 * page; this island asks the existing media-grants BFF for a same-origin
 * signed URL (Q158) and plays/loads it. One module-level promise per attempt
 * dedupes the call, so a page with many audio/image refs makes one request; a
 * grant that expires mid-view is refreshed once on the first play/load error.
 */

type GrantKind = 'audio' | 'image' | 'pdf' | 'video';

type ReviewGrant = {
  mediaId: number;
  kind: string;
  src: string;
  expiresAt: string;
};

type ReviewGrants = {
  grants: ReviewGrant[];
  unavailable: number[];
};

const grantCache = new Map<number, Promise<ReviewGrants>>();

/** Test hook: a fresh page/attempt must not reuse a previous suite's grants. */
export function resetReviewGrantsCache(): void {
  grantCache.clear();
}

async function fetchReviewGrants(attemptId: number): Promise<ReviewGrants> {
  const response = await fetch(
    `/api/learner/exam/attempts/${String(attemptId)}/media-grants`,
    { cache: 'no-store', credentials: 'same-origin' },
  );
  if (!response.ok) throw new Error(`media-grants ${String(response.status)}`);
  const body: unknown = await response.json();
  const data =
    body !== null && typeof body === 'object'
      ? (body as { data?: unknown }).data
      : undefined;
  if (data === null || typeof data !== 'object') {
    throw new Error('media-grants shape');
  }
  const grants = (data as { grants?: unknown }).grants;
  const unavailable = (data as { unavailable?: unknown }).unavailable;
  if (!Array.isArray(grants) || !Array.isArray(unavailable)) {
    throw new Error('media-grants shape');
  }
  return {
    grants: grants.flatMap((entry) => {
      if (entry === null || typeof entry !== 'object') return [];
      const grant = entry as Record<string, unknown>;
      if (
        typeof grant.mediaId !== 'number' ||
        typeof grant.kind !== 'string' ||
        typeof grant.src !== 'string' ||
        typeof grant.expiresAt !== 'string'
      ) {
        return [];
      }
      return [
        {
          mediaId: grant.mediaId,
          kind: grant.kind,
          src: grant.src,
          expiresAt: grant.expiresAt,
        },
      ];
    }),
    unavailable: unavailable.filter(
      (entry): entry is number => typeof entry === 'number',
    ),
  };
}

export function loadReviewGrants(
  attemptId: number,
  refresh = false,
): Promise<ReviewGrants> {
  if (refresh) grantCache.delete(attemptId);
  const cached = grantCache.get(attemptId);
  if (cached !== undefined) return cached;
  const pending = fetchReviewGrants(attemptId).catch((error: unknown) => {
    grantCache.delete(attemptId);
    throw error;
  });
  grantCache.set(attemptId, pending);
  return pending;
}

type MediaState =
  | { phase: 'loading' }
  | { phase: 'ready'; src: string }
  | { phase: 'unavailable' };

export function ExamReviewMedia({
  attemptId,
  mediaId,
  kind,
}: {
  attemptId: number;
  mediaId: number;
  kind: GrantKind;
}): React.ReactElement {
  const [state, setState] = useState<MediaState>({ phase: 'loading' });
  const retried = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const apply = (grants: ReviewGrants): void => {
      if (cancelled) return;
      const grant = grants.grants.find(
        (entry) => entry.mediaId === mediaId && entry.kind === kind,
      );
      setState(
        grant === undefined
          ? { phase: 'unavailable' }
          : { phase: 'ready', src: grant.src },
      );
    };
    loadReviewGrants(attemptId).then(apply, () => {
      if (!cancelled) setState({ phase: 'unavailable' });
    });
    return () => {
      cancelled = true;
    };
  }, [attemptId, mediaId, kind]);

  /** Q158: at most one refresh when the signed URL has expired mid-view. */
  const refreshOnce = (): void => {
    if (retried.current) {
      setState({ phase: 'unavailable' });
      return;
    }
    retried.current = true;
    loadReviewGrants(attemptId, true).then(
      (grants) => {
        const grant = grants.grants.find(
          (entry) => entry.mediaId === mediaId && entry.kind === kind,
        );
        setState(
          grant === undefined
            ? { phase: 'unavailable' }
            : { phase: 'ready', src: grant.src },
        );
      },
      () => setState({ phase: 'unavailable' }),
    );
  };

  if (state.phase === 'unavailable') {
    return (
      <p className="exv-media__unavailable">
        {reviewMediaLabel(kind === 'image' ? 'image' : 'audio')}
      </p>
    );
  }
  if (state.phase === 'loading') {
    return (
      <p className="exv-media__loading" role="status">
        Đang tải {kind === 'audio' ? 'âm thanh' : 'hình ảnh'}…
      </p>
    );
  }
  if (kind === 'audio') {
    return (
      <audio
        className="exv-media__audio"
        controls
        preload="none"
        aria-label="Âm thanh của câu hỏi"
        src={state.src}
        onError={refreshOnce}
      />
    );
  }
  if (kind === 'image') {
    return (
      <img
        className="exv-media__image"
        alt="Hình ảnh của câu hỏi"
        src={state.src}
        onError={refreshOnce}
      />
    );
  }
  return <p className="exv-media__unavailable">{reviewMediaLabel(kind)}</p>;
}
