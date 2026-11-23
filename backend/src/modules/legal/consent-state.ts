/**
 * M1.7b2 (Q189): the one rule for "has this user accepted the legal documents
 * they must accept". Pure, so route guards (phase B) and the API share it.
 */
export const LEGAL_DOCUMENT_TYPES = ['terms', 'privacy'] as const;
export type LegalDocumentTypeName = (typeof LEGAL_DOCUMENT_TYPES)[number];

export const OPTIONAL_CONSENT_TYPES = ['analytics', 'marketing'] as const;
export type OptionalConsentTypeName = (typeof OPTIONAL_CONSENT_TYPES)[number];

/** Same rule as LegalDocumentVersion_version_check in the migration. */
export const LEGAL_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/;
/** Lowercase hex SHA-256, as stored in `sha256` and `documentSha256`. */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** A new version may be postponed ("Để sau") this long before it takes effect. */
export const CONSENT_GRACE_DAYS = 14;
const GRACE_MS = CONSENT_GRACE_DAYS * 24 * 60 * 60 * 1000;

export type LegalVersionRecord = {
  type: LegalDocumentTypeName;
  version: string;
  sha256: string;
  effectiveAt: Date;
};

export type ConsentRecord = {
  type: string;
  consentVersion: string;
  documentSha256: string | null;
  revokedAt: Date | null;
};

export const DOCUMENT_CONSENT_STATUSES = [
  'accepted',
  'pending',
  'blocked',
  'not_required',
] as const;
export type DocumentConsentStatus = (typeof DOCUMENT_CONSENT_STATUSES)[number];

export type DocumentConsentState = {
  type: LegalDocumentTypeName;
  status: DocumentConsentStatus;
  version: string | null;
  sha256: string | null;
  effectiveAt: Date | null;
  /** Only for `pending`: the last moment "Để sau" is allowed. */
  deadline: Date | null;
};

/**
 * Current version of a type: the latest `effectiveAt` that is at most
 * `now + 14 days`. Ties on `effectiveAt` keep the first one in input order,
 * so callers pass versions newest-created first.
 */
export function currentLegalVersion(
  versions: readonly LegalVersionRecord[],
  type: LegalDocumentTypeName,
  now: Date,
): LegalVersionRecord | null {
  return latestVersionUpTo(versions, type, now.getTime() + GRACE_MS);
}

function latestVersionUpTo(
  versions: readonly LegalVersionRecord[],
  type: LegalDocumentTypeName,
  horizon: number,
): LegalVersionRecord | null {
  let current: LegalVersionRecord | null = null;
  for (const candidate of versions) {
    if (candidate.type !== type) continue;
    const at = candidate.effectiveAt.getTime();
    if (at > horizon) continue;
    if (current === null || at > current.effectiveAt.getTime()) {
      current = candidate;
    }
  }
  return current;
}

export function resolveConsentState(
  versions: readonly LegalVersionRecord[],
  consents: readonly ConsentRecord[],
  now: Date,
): DocumentConsentState[] {
  return LEGAL_DOCUMENT_TYPES.map((type) => {
    const current = currentLegalVersion(versions, type, now);
    if (current === null) {
      return {
        type,
        status: 'not_required',
        version: null,
        sha256: null,
        effectiveAt: null,
        deadline: null,
      };
    }
    const hasAccepted = (version: LegalVersionRecord) =>
      consents.some(
        (consent) =>
          consent.type === type &&
          consent.consentVersion === version.version &&
          consent.documentSha256 === version.sha256 &&
          consent.revokedAt === null,
      );
    // "Để sau" only postpones a new version: a user who never accepted the
    // version already in force stays blocked until they accept one.
    const inForce = latestVersionUpTo(versions, type, now.getTime());
    const status: DocumentConsentStatus = hasAccepted(current)
      ? 'accepted'
      : current === inForce || (inForce !== null && !hasAccepted(inForce))
        ? 'blocked'
        : 'pending';
    return {
      type,
      status,
      version: current.version,
      sha256: current.sha256,
      effectiveAt: current.effectiveAt,
      deadline: status === 'pending' ? current.effectiveAt : null,
    };
  });
}
