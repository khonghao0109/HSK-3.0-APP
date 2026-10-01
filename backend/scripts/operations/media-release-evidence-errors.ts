export type MediaReleaseEvidenceGateStatus =
  | 'BLOCKED_EXTERNAL'
  | 'FAIL_INTERNAL';

abstract class MediaReleaseEvidenceError extends Error {
  abstract readonly gateStatus: MediaReleaseEvidenceGateStatus;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ExternalEvidenceMissing extends MediaReleaseEvidenceError {
  readonly gateStatus = 'BLOCKED_EXTERNAL' as const;
}

export class ExternalEvidenceInvalid extends MediaReleaseEvidenceError {
  readonly gateStatus = 'BLOCKED_EXTERNAL' as const;
}

export class InternalToolFailure extends MediaReleaseEvidenceError {
  readonly gateStatus = 'FAIL_INTERNAL' as const;
}

export class InternalVerifierFailure extends MediaReleaseEvidenceError {
  readonly gateStatus = 'FAIL_INTERNAL' as const;
}

export class InternalRetentionFailure extends MediaReleaseEvidenceError {
  readonly gateStatus = 'FAIL_INTERNAL' as const;
}

export type CallerControlledEvidenceFileViolationKind = 'missing' | 'invalid';

/**
 * Marks a failure proven to come from caller-controlled file state. Raw
 * filesystem/runtime errors intentionally do not use this class.
 */
export class CallerControlledEvidenceFileViolation extends Error {
  constructor(
    readonly kind: CallerControlledEvidenceFileViolationKind,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export function classifyMediaReleaseEvidenceError(
  error: unknown,
): MediaReleaseEvidenceGateStatus {
  return error instanceof MediaReleaseEvidenceError
    ? error.gateStatus
    : 'FAIL_INTERNAL';
}

export function isMediaReleaseEvidenceError(
  error: unknown,
): error is MediaReleaseEvidenceError {
  return error instanceof MediaReleaseEvidenceError;
}

export type CosignVerificationResult =
  | { kind: 'success'; status: 0; stdout: string; stderr: string }
  | {
      kind: 'exit';
      status: number | null;
      stdout: string;
      stderr: string;
    }
  | { kind: 'missing'; stdout: string; stderr: string }
  | { kind: 'timeout'; stdout: string; stderr: string }
  | { kind: 'spawn-error'; stdout: string; stderr: string }
  | { kind: 'signal'; signal: string; stdout: string; stderr: string };

const UNSUPPORTED_CLI =
  /(?:unknown (?:flag|option|shorthand)|flag provided but not defined|unrecognized (?:flag|option)|invalid argument .* for .* flag)/iu;
const COSIGN_TOOL_OR_OUTAGE_FAILURE =
  /(?:\b(?:rekor|fulcio|tuf|trusted root|transparency log|certificate transparency)\b[^\n]*(?:connection refused|connection reset|context deadline exceeded|i\/o timeout|network (?:is )?unreachable|no such host|service unavailable|temporar(?:ily|y) unavailable|tls handshake timeout)|\b(?:dial tcp|connection refused|connection reset|context deadline exceeded|i\/o timeout|network (?:is )?unreachable|no such host|temporary failure in name resolution|tls handshake timeout)\b|\b(?:panic: runtime error|internal decoder invariant|verifier response parser boundary)\b)/iu;
const EXTERNAL_COSIGN_REJECTION =
  /(?:no matching signatures|none of the expected (?:identities|issuers) matched|certificate (?:identity|issuer|workflow(?: name| ref| repository| sha| trigger)?) mismatch|invalid signature|signature (?:(?:is|was) )?invalid|payload digest mismatch|bundle (?:is invalid|does not match|is malformed)|invalid character .+ looking for beginning of value|unexpected end of json input|(?:failed to|error (?:while )?)(?:decode|parse|unmarshal)(?: the)?(?: sigstore)? bundle)/iu;

/**
 * Separates a healthy verifier rejecting supplied bytes from a broken verifier
 * boundary. Diagnostic bytes are intentionally not copied into the exception.
 */
export function assertCosignVerificationSucceeded(
  result: CosignVerificationResult,
  label: string,
): void {
  if (result.kind === 'success') return;
  const diagnostic = `${result.stdout}\n${result.stderr}`;
  if (
    result.kind === 'missing' ||
    result.kind === 'timeout' ||
    result.kind === 'spawn-error' ||
    result.kind === 'signal' ||
    result.status === null ||
    UNSUPPORTED_CLI.test(diagnostic) ||
    COSIGN_TOOL_OR_OUTAGE_FAILURE.test(diagnostic)
  ) {
    throw new InternalToolFailure(`${label} Cosign verifier is unavailable.`);
  }
  if (EXTERNAL_COSIGN_REJECTION.test(diagnostic)) {
    throw new ExternalEvidenceInvalid(
      `${label} detached signature or certificate claims are invalid.`,
    );
  }
  throw new InternalToolFailure(`${label} Cosign verifier failed internally.`);
}

export function rethrowStableEvidenceReadFailure(
  error: unknown,
  label: string,
): never {
  if (isMediaReleaseEvidenceError(error)) throw error;
  if (error instanceof CallerControlledEvidenceFileViolation) {
    if (error.kind === 'missing') {
      throw new ExternalEvidenceMissing(`${label} is absent.`);
    }
    throw new ExternalEvidenceInvalid(`${label} is unsafe or malformed.`);
  }
  throw new InternalVerifierFailure(
    `${label} stable file verifier failed internally.`,
  );
}

const EXTERNAL_DETACHED_EVIDENCE_FAILURES = new Set([
  'Verified evidence payload digest does not match.',
  'Verified evidence bundle digest is invalid.',
  'Verified evidence issuer is not approved.',
  'Verified evidence identity is not approved.',
  'Verified evidence trust result is stale.',
  'Verified evidence payload is not valid JSON.',
]);

export function rethrowDetachedEvidenceFailure(
  error: unknown,
  label: string,
): never {
  if (isMediaReleaseEvidenceError(error)) throw error;
  if (
    error instanceof Error &&
    EXTERNAL_DETACHED_EVIDENCE_FAILURES.has(error.message)
  ) {
    throw new ExternalEvidenceInvalid(`${label} is stale or invalid.`);
  }
  throw new InternalVerifierFailure(`${label} verifier failed internally.`);
}

const TLS_CERTIFICATE_REJECTION_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REJECTED',
  'CERT_SIGNATURE_FAILURE',
  'CERT_UNTRUSTED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

const RUNBOOK_CONNECTIVITY_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

export function rethrowProductionRunbookEvidenceFailure(error: unknown): never {
  if (isMediaReleaseEvidenceError(error)) throw error;
  const message = error instanceof Error ? error.message : '';
  const code =
    error && typeof error === 'object'
      ? (error as NodeJS.ErrnoException).code
      : undefined;
  if (
    TLS_CERTIFICATE_REJECTION_CODES.has(code ?? '') ||
    /Production runbook (?:DNS returned|must return|response|body|is missing|required marker|revision)/u.test(
      message,
    ) ||
    message === 'Response body exceeds its bounded limit.' ||
    message === 'Response Content-Length is malformed.'
  ) {
    throw new ExternalEvidenceInvalid(
      'Production runbook evidence is invalid.',
    );
  }
  if (
    /Production runbook (?:A-record|AAAA-record|DNS resolution|HTTPS request)/u.test(
      message,
    ) ||
    RUNBOOK_CONNECTIVITY_CODES.has(code ?? '')
  ) {
    throw new ExternalEvidenceMissing(
      'Production runbook evidence is currently unreachable.',
    );
  }
  throw new InternalVerifierFailure(
    'Production runbook verifier failed internally.',
  );
}

export type SpecializedVerificationOutcome =
  | 'PASS'
  | MediaReleaseEvidenceGateStatus
  | 'MISSING';

export function rethrowMissingSpecializedVerification(
  outcomes: readonly SpecializedVerificationOutcome[],
  label: string,
): never {
  if (
    outcomes.length > 0 &&
    outcomes.every((outcome) => outcome === 'BLOCKED_EXTERNAL')
  ) {
    throw new ExternalEvidenceMissing(
      `${label} awaits specialized external verification.`,
    );
  }
  throw new InternalVerifierFailure(
    `${label} specialized verifier registry is incomplete.`,
  );
}

const FINALIZED_INVENTORY_EXTERNAL_FAILURES = [
  /^Verified prerequisite evidence has no matching PASS prerequisite\.$/u,
  /^Verified prerequisite evidence must match every PASS prerequisite exactly\.$/u,
  /^Verified prerequisite evidence is unexpected for non-PASS item: media-[a-z0-9-]+\.$/u,
  /^media-[a-z0-9-]+ cannot PASS without its exact specialized verification record\.$/u,
  /^media-[a-z0-9-]+ cannot reuse another prerequisite's verified evidence digest\.$/u,
  /^media-[a-z0-9-]+ evidence is stale or has invalid freshness\.$/u,
];

export function rethrowFinalizedPrerequisiteInventoryFailure(
  error: unknown,
): never {
  if (isMediaReleaseEvidenceError(error)) throw error;
  if (
    error instanceof Error &&
    (error.name === 'MediaProductionPrerequisiteContractError' ||
      FINALIZED_INVENTORY_EXTERNAL_FAILURES.some((pattern) =>
        pattern.test(error.message),
      ))
  ) {
    throw new ExternalEvidenceInvalid(
      'External production prerequisite evidence contract was rejected.',
    );
  }
  throw new InternalVerifierFailure(
    'Production prerequisite inventory parser failed internally.',
  );
}
