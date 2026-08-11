import { ConflictException, ForbiddenException } from '@nestjs/common';

export type CmsActor = {
  id: number;
  role: string;
};

export function assertAdminActor(actor: CmsActor): void {
  if (actor.role !== 'admin') {
    throw new ForbiddenException('Insufficient role.');
  }
}

export type PublishAction = 'apply' | 'idempotent';

export function decidePublishAction(input: {
  requestedRevisionId: number;
  latestRevisionId: number;
  latestDecision: 'approved' | 'changes_requested' | 'rejected' | null;
  liveContentHash: string | null;
  requestedContentHash: string;
  liveContentMatchesRevision?: boolean;
}): PublishAction {
  if (input.requestedRevisionId !== input.latestRevisionId) {
    throw new ConflictException(
      'Only the latest content revision can be published.',
    );
  }

  if (input.latestDecision !== 'approved') {
    throw new ConflictException(
      'The latest review decision must approve this revision.',
    );
  }

  return input.liveContentMatchesRevision === true ||
    input.liveContentHash === input.requestedContentHash
    ? 'idempotent'
    : 'apply';
}

export type CmsPersistenceErrorKind =
  | 'unique_conflict'
  | 'concurrent_retry'
  | 'timeout'
  | 'unknown';

export function classifyCmsPersistenceError(
  error: unknown,
): CmsPersistenceErrorKind {
  const codes = collectSafeErrorCodes(error);

  if (codes.has('P2002') || codes.has('23505')) return 'unique_conflict';
  if (codes.has('P2034') || codes.has('P2028') || codes.has('40P01')) {
    return 'concurrent_retry';
  }
  if (codes.has('55P03') || codes.has('57014')) return 'timeout';
  return 'unknown';
}

function collectSafeErrorCodes(error: unknown): Set<string> {
  const result = new Set<string>();
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current !== 'object') break;
    const record = current as Record<string, unknown>;
    for (const key of ['code', 'sqlState', 'sqlstate']) {
      if (typeof record[key] === 'string') result.add(record[key]);
    }
    current = record.cause ?? record.meta;
  }

  return result;
}
