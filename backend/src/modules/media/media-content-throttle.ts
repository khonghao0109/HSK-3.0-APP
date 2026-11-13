import { createHash } from 'node:crypto';

import { ipTracker } from '../../common/guards/custom-throttler.guard';
import mediaConfig from '../../config/media.config';
import { LEARNER_MEDIA_ACCESS_TTL_SECONDS } from './media-access.service';

const MEDIA_ID = /^[1-9]\d{0,15}$/u;
const EXPIRES = /^\d{1,10}$/u;
const SIGNATURE = /^[a-f0-9]{64}$/u;
// Clock skew allowance on top of the longest grant this service issues.
const EXPIRY_SKEW_SECONDS = 60;

type GrantRequest = {
  ip?: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
};

/** Per-grant budget for the public content route (Q46). */
export function mediaContentGrantLimit(): number {
  return process.env.NODE_ENV === 'test' ? 1_000 : 60;
}

/** Per-user budget for minting grants (Q46). */
export function mediaAccessLimit(): number {
  return process.env.NODE_ENV === 'test' ? 1_000 : 120;
}

/**
 * Buckets a content request by its grant, so learners behind one NAT do not
 * share a budget. The signature cannot be verified here (it covers the DB
 * checksum), so the key is a hash of the claimed grant and only well-formed,
 * currently plausible grants get one; anything else falls back to the IP.
 */
export function grantTracker(req: GrantRequest): string {
  const mediaId = req.params?.mediaId;
  const expires = req.query?.expires;
  const signature = req.query?.signature;
  if (
    typeof mediaId !== 'string' ||
    typeof expires !== 'string' ||
    typeof signature !== 'string' ||
    !MEDIA_ID.test(mediaId) ||
    !Number.isSafeInteger(Number(mediaId)) ||
    !EXPIRES.test(expires) ||
    !SIGNATURE.test(signature)
  ) {
    return ipTracker(req);
  }
  const now = Math.floor(Date.now() / 1000);
  const maxTtl = Math.max(
    LEARNER_MEDIA_ACCESS_TTL_SECONDS,
    mediaConfig().media.accessTtlSeconds,
  );
  const expiresAt = Number(expires);
  if (expiresAt < now || expiresAt > now + maxTtl + EXPIRY_SKEW_SECONDS) {
    return ipTracker(req);
  }
  const digest = createHash('sha256')
    .update(`${mediaId}:${expires}:${signature}`)
    .digest('hex');
  return `grant:${digest}`;
}
