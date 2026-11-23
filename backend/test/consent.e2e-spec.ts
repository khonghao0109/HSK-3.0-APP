/// <reference types="jest" />

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import {
  OBJECT_STORAGE,
  ObjectStoragePort,
} from '../src/infrastructure/storage/object-storage.port';
import { DataExportJob } from '../src/modules/user/jobs/data-export.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type Envelope<T> = { success: boolean; data: T };
type DocumentState = {
  type: string;
  status: string;
  version: string | null;
  sha256: string | null;
  effectiveAt: string | null;
  deadline: string | null;
};
type ConsentsResponse = {
  documents: DocumentState[];
  optional: Array<{ type: string; granted: boolean }>;
};

/** M1.7b2 Consent API (Q187–Q193, Q197). */
describe('Consent API E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let exportHandler: DataExportJob;

  const stamp = Date.now().toString(36);
  // Versions owned by this suite only; LegalDocumentVersion_version_check allows [._-].
  const VERSION_PREFIX = 'e2e-c-';
  const termsVersion = `${VERSION_PREFIX}${stamp}-t`;
  const privacyVersion = `${VERSION_PREFIX}${stamp}-p`;
  const termsSha = createHash('sha256').update(`terms-${stamp}`).digest('hex');
  const privacySha = createHash('sha256')
    .update(`privacy-${stamp}`)
    .digest('hex');
  const effectiveAt = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const prefix = `e2e_consent_${stamp}`;
  const password = 'Password123!';
  const http = () => request(app.getHttpServer());
  const termsDoc = () => ({
    type: 'terms',
    version: termsVersion,
    sha256: termsSha,
  });
  const privacyDoc = () => ({
    type: 'privacy',
    version: privacyVersion,
    sha256: privacySha,
  });

  const registerUser = async (
    label: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ token: string; userId: number }> => {
    const email = `${prefix}_${label}@example.com`;
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email, password, ...extra })
      .expect(HttpStatus.CREATED);
    const token = (res.body as Envelope<{ accessToken: string }>).data
      .accessToken;
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    return { token, userId: user.id };
  };

  const consentAudits = (userId: number) =>
    prisma.auditLog.findMany({
      where: { actorId: userId, action: { startsWith: 'consent.' } },
      orderBy: { id: 'asc' },
    });

  const cleanupVersions = () =>
    prisma.legalDocumentVersion.deleteMany({
      where: { version: { startsWith: VERSION_PREFIX } },
    });

  beforeAll(async () => {
    assertDisposableTestDatabase();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: createSafeValidationException,
      }),
    );
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    exportHandler = new DataExportJob(
      null,
      prisma,
      app.get<ObjectStoragePort>(OBJECT_STORAGE),
    );

    // Leftovers of an interrupted earlier run would shadow this run's versions.
    await cleanupVersions();
    await prisma.legalDocumentVersion.createMany({
      data: [
        { type: 'terms', version: termsVersion, sha256: termsSha, effectiveAt },
        {
          type: 'privacy',
          version: privacyVersion,
          sha256: privacySha,
          effectiveAt,
        },
      ],
    });
  });

  afterAll(async () => {
    if (prisma) await cleanupVersions();
    await app?.close();
  });

  describe('GET /legal/documents/current', () => {
    it('is public and returns the current version of each type', async () => {
      const res = await http()
        .get('/api/v1/legal/documents/current')
        .expect(HttpStatus.OK);
      expect(res.headers['cache-control']).toBe('no-store');
      expect((res.body as Envelope<unknown>).data).toEqual([
        {
          type: 'terms',
          version: termsVersion,
          sha256: termsSha,
          effectiveAt: effectiveAt.toISOString(),
        },
        {
          type: 'privacy',
          version: privacyVersion,
          sha256: privacySha,
          effectiveAt: effectiveAt.toISOString(),
        },
      ]);
    });
  });

  describe('authentication', () => {
    it('answers 401 on every /users/me/consents route without a JWT', async () => {
      await http()
        .get('/api/v1/users/me/consents')
        .expect(HttpStatus.UNAUTHORIZED);
      await http()
        .post('/api/v1/users/me/consents/accept')
        .send({ documents: [termsDoc()] })
        .expect(HttpStatus.UNAUTHORIZED);
      await http()
        .put('/api/v1/users/me/consents/optional/analytics')
        .send({ granted: true })
        .expect(HttpStatus.UNAUTHORIZED);
    });
  });

  describe('POST /users/me/consents/accept', () => {
    it('rejects a wrong hash or version with 400 and writes nothing', async () => {
      const { token, userId } = await registerUser('accept_bad');
      for (const documents of [
        [{ ...termsDoc(), sha256: 'f'.repeat(64) }],
        [{ ...termsDoc(), version: `${termsVersion}x` }],
        [termsDoc(), { ...privacyDoc(), sha256: termsSha }],
        [termsDoc(), termsDoc()],
      ]) {
        const res = await http()
          .post('/api/v1/users/me/consents/accept')
          .set('Authorization', `Bearer ${token}`)
          .send({ documents })
          .expect(HttpStatus.BAD_REQUEST);
        expect(res.body.error.code).toBe('LEGAL_DOCUMENT_MISMATCH');
      }
      expect(await prisma.consent.count({ where: { userId } })).toBe(0);
      expect(await consentAudits(userId)).toHaveLength(0);
    });

    it('records reconsent rows with hash and audit, and is idempotent', async () => {
      const { token, userId } = await registerUser('accept_ok');

      const before = await http()
        .get('/api/v1/users/me/consents')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);
      expect(before.headers['cache-control']).toBe('no-store');
      expect(
        (before.body as Envelope<ConsentsResponse>).data.documents.map(
          (d) => d.status,
        ),
      ).toEqual(['blocked', 'blocked']);

      for (let i = 0; i < 2; i += 1) {
        const res = await http()
          .post('/api/v1/users/me/consents/accept')
          .set('Authorization', `Bearer ${token}`)
          .send({ documents: [termsDoc(), privacyDoc()] })
          .expect(HttpStatus.OK);
        expect((res.body as Envelope<ConsentsResponse>).data).toEqual({
          documents: [
            {
              type: 'terms',
              status: 'accepted',
              version: termsVersion,
              sha256: termsSha,
              effectiveAt: effectiveAt.toISOString(),
              deadline: null,
            },
            {
              type: 'privacy',
              status: 'accepted',
              version: privacyVersion,
              sha256: privacySha,
              effectiveAt: effectiveAt.toISOString(),
              deadline: null,
            },
          ],
          optional: [
            { type: 'analytics', granted: false },
            { type: 'marketing', granted: false },
          ],
        });
      }

      const rows = await prisma.consent.findMany({
        where: { userId },
        orderBy: { type: 'asc' },
      });
      expect(
        rows.map((r) => [
          r.type,
          r.consentVersion,
          r.documentSha256,
          r.channel,
          r.revokedAt,
        ]),
      ).toEqual([
        ['terms', termsVersion, termsSha, 'reconsent', null],
        ['privacy', privacyVersion, privacySha, 'reconsent', null],
      ]);
      const audits = await consentAudits(userId);
      expect(audits.map((a) => [a.action, a.afterSummary])).toEqual([
        [
          'consent.document_accepted',
          { type: 'terms', version: termsVersion, channel: 'reconsent' },
        ],
        [
          'consent.document_accepted',
          { type: 'privacy', version: privacyVersion, channel: 'reconsent' },
        ],
      ]);
      // Q192: no IP or user agent is kept for consent.
      expect(audits.every((a) => a.ipAddress === null)).toBe(true);
      expect(audits.every((a) => a.userAgent === null)).toBe(true);
    });
  });

  describe('PUT /users/me/consents/optional/:type', () => {
    it('grants, revokes and grants again on one row without deleting it', async () => {
      const { token, userId } = await registerUser('optional');
      const put = (granted: boolean) =>
        http()
          .put('/api/v1/users/me/consents/optional/analytics')
          .set('Authorization', `Bearer ${token}`)
          .send({ granted })
          .expect(HttpStatus.OK);
      const row = () =>
        prisma.consent.findMany({ where: { userId, type: 'analytics' } });

      expect((await put(true)).body.data).toEqual({
        type: 'analytics',
        granted: true,
      });
      const [granted] = await row();
      expect(granted.revokedAt).toBeNull();
      expect(granted.channel).toBe('settings');
      expect(granted.documentSha256).toBeNull();

      expect((await put(false)).body.data).toEqual({
        type: 'analytics',
        granted: false,
      });
      const revoked = await row();
      expect(revoked).toHaveLength(1);
      expect(revoked[0].id).toBe(granted.id);
      expect(revoked[0].revokedAt).not.toBeNull();

      await put(false); // already off: no new write, no audit
      await put(true);
      const again = await row();
      expect(again).toHaveLength(1);
      expect(again[0].id).toBe(granted.id);
      expect(again[0].revokedAt).toBeNull();

      const res = await http()
        .get('/api/v1/users/me/consents')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);
      expect((res.body as Envelope<ConsentsResponse>).data.optional).toEqual([
        { type: 'analytics', granted: true },
        { type: 'marketing', granted: false },
      ]);
      expect(
        (await consentAudits(userId)).map((a) => [a.action, a.afterSummary]),
      ).toEqual([
        [
          'consent.optional_granted',
          { type: 'analytics', channel: 'settings' },
        ],
        [
          'consent.optional_revoked',
          { type: 'analytics', channel: 'settings' },
        ],
        [
          'consent.optional_granted',
          { type: 'analytics', channel: 'settings' },
        ],
      ]);
    });

    it('rejects a document type or a non-boolean body with 400', async () => {
      const { token, userId } = await registerUser('optional_bad');
      await http()
        .put('/api/v1/users/me/consents/optional/terms')
        .set('Authorization', `Bearer ${token}`)
        .send({ granted: false })
        .expect(HttpStatus.BAD_REQUEST);
      await http()
        .put('/api/v1/users/me/consents/optional/marketing')
        .set('Authorization', `Bearer ${token}`)
        .send({ granted: 'true' })
        .expect(HttpStatus.BAD_REQUEST);
      expect(await prisma.consent.count({ where: { userId } })).toBe(0);
    });
  });

  describe('isolation between users', () => {
    it('keeps each user to their own consents', async () => {
      const a = await registerUser('iso_a');
      const b = await registerUser('iso_b');
      await http()
        .post('/api/v1/users/me/consents/accept')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ documents: [termsDoc()] })
        .expect(HttpStatus.OK);
      await http()
        .put('/api/v1/users/me/consents/optional/marketing')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ granted: true })
        .expect(HttpStatus.OK);

      const resB = await http()
        .get('/api/v1/users/me/consents')
        .set('Authorization', `Bearer ${b.token}`)
        .expect(HttpStatus.OK);
      const dataB = (resB.body as Envelope<ConsentsResponse>).data;
      expect(dataB.documents.map((d) => d.status)).toEqual([
        'blocked',
        'blocked',
      ]);
      expect(dataB.optional).toEqual([
        { type: 'analytics', granted: false },
        { type: 'marketing', granted: false },
      ]);

      await http()
        .put('/api/v1/users/me/consents/optional/marketing')
        .set('Authorization', `Bearer ${b.token}`)
        .send({ granted: false })
        .expect(HttpStatus.OK);
      const rowA = await prisma.consent.findFirstOrThrow({
        where: { userId: a.userId, type: 'marketing' },
      });
      expect(rowA.revokedAt).toBeNull();
      expect(await prisma.consent.count({ where: { userId: b.userId } })).toBe(
        0,
      );
    });
  });

  describe('POST /auth/register', () => {
    it('records signup consent in the same transaction when acceptedDocuments match', async () => {
      const { userId } = await registerUser('signup', {
        acceptedDocuments: [termsDoc(), privacyDoc()],
      });
      const rows = await prisma.consent.findMany({
        where: { userId },
        orderBy: { type: 'asc' },
      });
      expect(
        rows.map((r) => [
          r.type,
          r.consentVersion,
          r.documentSha256,
          r.channel,
        ]),
      ).toEqual([
        ['terms', termsVersion, termsSha, 'signup'],
        ['privacy', privacyVersion, privacySha, 'signup'],
      ]);
      expect((await consentAudits(userId)).map((a) => a.afterSummary)).toEqual([
        { type: 'terms', version: termsVersion, channel: 'signup' },
        { type: 'privacy', version: privacyVersion, channel: 'signup' },
      ]);
    });

    it('rejects acceptedDocuments that are not current and creates no user', async () => {
      const email = `${prefix}_signup_bad@example.com`;
      const res = await http()
        .post('/api/v1/auth/register')
        .send({
          email,
          password,
          acceptedDocuments: [{ ...termsDoc(), sha256: privacySha }],
        })
        .expect(HttpStatus.BAD_REQUEST);
      expect(res.body.error.code).toBe('LEGAL_DOCUMENT_MISMATCH');
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    it('still registers without acceptedDocuments and writes no consent', async () => {
      const { userId } = await registerUser('signup_plain');
      expect(await prisma.consent.count({ where: { userId } })).toBe(0);
    });
  });

  describe('data export', () => {
    it('includes consent rows with hash and channel', async () => {
      const { token } = await registerUser('export', {
        acceptedDocuments: [termsDoc()],
      });
      const created = await http()
        .post('/api/v1/users/me/data-exports')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.ACCEPTED);
      const exportId = (created.body as Envelope<{ exportId: number }>).data
        .exportId;
      expect(await exportHandler.process({ exportId })).toBe(true);
      const download = await http()
        .get(`/api/v1/users/me/data-exports/${exportId}/download`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);
      const content = JSON.parse(download.text) as {
        consents: Array<Record<string, unknown>>;
      };
      expect(content.consents).toHaveLength(1);
      expect(content.consents[0]).toMatchObject({
        type: 'terms',
        consentVersion: termsVersion,
        documentSha256: termsSha,
        channel: 'signup',
        revokedAt: null,
      });
    });
  });

  describe('schema', () => {
    it('has no IP or user-agent column on Consent or LegalDocumentVersion', async () => {
      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name IN ('Consent', 'LegalDocumentVersion')
      `;
      const names = columns.map((c) => c.column_name.toLowerCase());
      expect(names).toContain('documentsha256');
      expect(names.filter((n) => /ip|agent/.test(n))).toEqual([]);
    });
  });

  describe('legal:register-version script', () => {
    const runScript = (file: string) =>
      spawnSync(
        'npx',
        [
          'ts-node',
          'scripts/legal/register-legal-version.ts',
          '--type',
          'privacy',
          '--version',
          `${VERSION_PREFIX}${stamp}-s`,
          '--file',
          file,
          // Far ahead, so this version never becomes current for other tests.
          '--effective-at',
          '2099-01-01T00:00:00Z',
        ],
        { encoding: 'utf8', env: process.env },
      );
    const fileA = resolve(__dirname, 'fixtures/legal/sample-a.md');
    const fileB = resolve(__dirname, 'fixtures/legal/sample-b.md');

    it('is idempotent and refuses the same version with another hash', async () => {
      const where = {
        type: 'privacy' as const,
        version: `${VERSION_PREFIX}${stamp}-s`,
      };
      const first = runScript(fileA);
      expect(first.status).toBe(0);
      expect(first.stdout).toContain('"status":"created"');
      const created = await prisma.legalDocumentVersion.findMany({ where });
      expect(created).toHaveLength(1);
      // Stored as given, whatever the server's default session time zone.
      expect(created[0].effectiveAt.toISOString()).toBe(
        '2099-01-01T00:00:00.000Z',
      );
      expect(created[0].sha256).toBe(
        createHash('sha256').update(readFileSync(fileA)).digest('hex'),
      );

      const second = runScript(fileA);
      expect(second.status).toBe(0);
      expect(second.stdout).toContain('"status":"unchanged"');
      expect(await prisma.legalDocumentVersion.findMany({ where })).toEqual(
        created,
      );

      const conflict = runScript(fileB);
      expect(conflict.status).toBe(1);
      expect(conflict.stdout).toContain('"status":"rejected"');
      expect(await prisma.legalDocumentVersion.findMany({ where })).toEqual(
        created,
      );
    }, 120_000);
  });
});
