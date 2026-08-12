import { ConflictException } from '@nestjs/common';
import { MediaProcessingStatus, MediaType, Prisma } from '@prisma/client';

type MediaPolicyRecord = {
  id: number;
  url: string;
  type: MediaType;
  mimeType: string | null;
  size: number | null;
  duration: number | null;
  storageProvider: string | null;
  storageKey: string | null;
  originalFilename: string | null;
  checksum: string | null;
  processingStatus: MediaProcessingStatus;
  metadata: Prisma.JsonValue | null;
  dataSourceId: number | null;
  uploadedById: number | null;
  updatedById: number | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type SafeDataSource = {
  id: number;
  code: string;
  name: string;
  version: string;
} | null;

export type MediaLifecycleOperation = 'archive' | 'quarantine';
export type MediaLifecycleDecision = 'apply' | 'idempotent';

export function safeMediaFilename(value: string | null): string | null {
  if (!value) return null;
  const segments = value.normalize('NFKC').split(/[\\/]/u);
  const basename = segments[segments.length - 1] ?? '';
  const normalized = Array.from(basename)
    .filter((character) => !isUnsafeFilenameCharacter(character))
    .join('')
    .trim()
    .slice(0, 160);
  return normalized.length > 0 ? normalized : null;
}

function isUnsafeFilenameCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    codePoint <= 0x1f ||
    codePoint === 0x7f ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

export function projectAdminMedia(
  media: MediaPolicyRecord,
  context: { usageCount: number; dataSource: SafeDataSource },
) {
  return {
    id: media.id,
    filename: safeMediaFilename(media.originalFilename),
    type: media.type,
    mimeType: media.mimeType,
    size: media.size,
    duration: media.duration,
    processingStatus: media.processingStatus,
    lifecycle: media.deletedAt ? ('archived' as const) : ('active' as const),
    usageCount: context.usageCount,
    dataSourceId: media.dataSourceId,
    uploadedById: media.uploadedById,
    updatedById: media.updatedById,
    deletedAt: media.deletedAt,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
    dataSource: context.dataSource,
  };
}

export function mediaLifecycleDecision(
  operation: MediaLifecycleOperation,
  media: Pick<MediaPolicyRecord, 'deletedAt' | 'processingStatus'>,
): MediaLifecycleDecision {
  if (operation === 'archive') {
    return media.deletedAt ? 'idempotent' : 'apply';
  }
  if (media.deletedAt) {
    throw new ConflictException('Archived media cannot be quarantined.');
  }
  return media.processingStatus === 'quarantined' ? 'idempotent' : 'apply';
}
