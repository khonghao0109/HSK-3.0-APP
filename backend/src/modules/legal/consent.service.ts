import { BadRequestException, Injectable } from '@nestjs/common';
import { ConsentChannel, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import {
  currentLegalVersion,
  LEGAL_DOCUMENT_TYPES,
  LegalVersionRecord,
  OPTIONAL_CONSENT_TYPES,
  OptionalConsentTypeName,
  resolveConsentState,
} from './consent-state';
import {
  AcceptedDocumentDto,
  CurrentLegalDocumentDto,
  OptionalConsentStateDto,
  UserConsentsResponseDto,
} from './dto/consent.dto';

/**
 * Optional consents have no document version. One row per user and type
 * (`@@unique([userId, type, consentVersion])`); toggling flips `revokedAt`.
 */
export const OPTIONAL_CONSENT_VERSION = '1';

const MISMATCH = {
  code: 'LEGAL_DOCUMENT_MISMATCH',
  message: 'Legal document type, version or hash does not match.',
};

/** One entry per document type; a repeated type is a client error. */
function assertDistinctTypes(documents: readonly AcceptedDocumentDto[]): void {
  if (new Set(documents.map((d) => d.type)).size !== documents.length) {
    throw new BadRequestException(MISMATCH);
  }
}

@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadVersions(
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<LegalVersionRecord[]> {
    // Newest first, so equal effectiveAt resolves to the latest registration.
    return client.legalDocumentVersion.findMany({
      select: { type: true, version: true, sha256: true, effectiveAt: true },
      orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }],
    });
  }

  async getCurrentDocuments(
    now = new Date(),
  ): Promise<CurrentLegalDocumentDto[]> {
    const versions = await this.loadVersions();
    return LEGAL_DOCUMENT_TYPES.flatMap((type) => {
      const current = currentLegalVersion(versions, type, now);
      return current === null ? [] : [current];
    });
  }

  async getUserConsents(
    userId: number,
    now = new Date(),
  ): Promise<UserConsentsResponseDto> {
    const [versions, consents] = await Promise.all([
      this.loadVersions(),
      this.prisma.consent.findMany({
        where: { userId },
        select: {
          type: true,
          consentVersion: true,
          documentSha256: true,
          revokedAt: true,
        },
      }),
    ]);
    const optional: OptionalConsentStateDto[] = OPTIONAL_CONSENT_TYPES.map(
      (type) => ({
        type,
        granted: consents.some(
          (consent) => consent.type === type && consent.revokedAt === null,
        ),
      }),
    );
    return {
      documents: resolveConsentState(versions, consents, now),
      optional,
    };
  }

  /** Sign-up: every submitted document must be the current version of its type. */
  async resolveSignupDocuments(
    documents: readonly AcceptedDocumentDto[],
    now = new Date(),
  ): Promise<LegalVersionRecord[]> {
    assertDistinctTypes(documents);
    const versions = await this.loadVersions();
    return documents.map((document) => {
      const current = currentLegalVersion(versions, document.type, now);
      if (
        current === null ||
        current.version !== document.version ||
        current.sha256 !== document.sha256
      ) {
        throw new BadRequestException(MISMATCH);
      }
      return current;
    });
  }

  /** Re-consent: every submitted document must be a registered version. */
  private async resolveRegisteredDocuments(
    tx: Prisma.TransactionClient,
    documents: readonly AcceptedDocumentDto[],
  ): Promise<LegalVersionRecord[]> {
    assertDistinctTypes(documents);
    const versions = await this.loadVersions(tx);
    return documents.map((document) => {
      const match = versions.find(
        (version) =>
          version.type === document.type &&
          version.version === document.version &&
          version.sha256 === document.sha256,
      );
      if (match === undefined) throw new BadRequestException(MISMATCH);
      return match;
    });
  }

  /**
   * Writes one consent row per document unless the user already has it, and
   * an AuditLog row for each row written. Caller owns the transaction.
   */
  async recordDocumentConsents(
    tx: Prisma.TransactionClient,
    userId: number,
    documents: readonly LegalVersionRecord[],
    channel: ConsentChannel,
  ): Promise<void> {
    for (const document of documents) {
      const inserted = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        INSERT INTO "Consent" ("userId", "type", "consentVersion", "policyVersion", "documentSha256", "channel", "updatedAt")
        VALUES (${userId}, ${document.type}::"ConsentType", ${document.version}, ${document.version},
                ${document.sha256}, ${channel}::"ConsentChannel", CURRENT_TIMESTAMP)
        ON CONFLICT ("userId", "type", "consentVersion") DO NOTHING
        RETURNING id
      `);
      if (inserted.length === 0) continue;
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'consent.document_accepted',
          targetType: 'User',
          targetId: String(userId),
          afterSummary: {
            type: document.type,
            version: document.version,
            channel,
          },
        },
      });
    }
  }

  async acceptDocuments(
    userId: number,
    documents: readonly AcceptedDocumentDto[],
  ): Promise<UserConsentsResponseDto> {
    await this.prisma.$transaction(async (tx) => {
      const resolved = await this.resolveRegisteredDocuments(tx, documents);
      await this.recordDocumentConsents(tx, userId, resolved, 'reconsent');
    });
    return this.getUserConsents(userId);
  }

  async setOptionalConsent(
    userId: number,
    type: OptionalConsentTypeName,
    granted: boolean,
  ): Promise<OptionalConsentStateDto> {
    await this.prisma.$transaction(async (tx) => {
      // RETURNING yields a row only when the state actually changed.
      const changed = granted
        ? await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
            INSERT INTO "Consent" ("userId", "type", "consentVersion", "policyVersion", "channel", "updatedAt")
            VALUES (${userId}, ${type}::"ConsentType", ${OPTIONAL_CONSENT_VERSION}, ${OPTIONAL_CONSENT_VERSION},
                    'settings'::"ConsentChannel", CURRENT_TIMESTAMP)
            ON CONFLICT ("userId", "type", "consentVersion") DO UPDATE
              SET "revokedAt" = NULL,
                  "grantedAt" = CURRENT_TIMESTAMP,
                  "channel" = 'settings'::"ConsentChannel",
                  "updatedAt" = CURRENT_TIMESTAMP
              WHERE "Consent"."revokedAt" IS NOT NULL
            RETURNING id
          `)
        : await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
            UPDATE "Consent"
            SET "revokedAt" = CURRENT_TIMESTAMP,
                "channel" = 'settings'::"ConsentChannel",
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "userId" = ${userId}
              AND "type" = ${type}::"ConsentType"
              AND "consentVersion" = ${OPTIONAL_CONSENT_VERSION}
              AND "revokedAt" IS NULL
            RETURNING id
          `);
      if (changed.length === 0) return;
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: granted
            ? 'consent.optional_granted'
            : 'consent.optional_revoked',
          targetType: 'User',
          targetId: String(userId),
          afterSummary: { type, channel: 'settings' },
        },
      });
    });
    return { type, granted };
  }
}
