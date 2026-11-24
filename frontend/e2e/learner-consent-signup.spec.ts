import { createHash } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  disposableDbUrl,
  queryDisposableDb,
  sqlLiteral,
} from './support/disposable-db';

/**
 * M1.7b2 B1 (Q188): sign-up has a mandatory, never pre-ticked checkbox; the
 * BFF forwards the current legal versions the learner accepted.
 */
const CONSENT_NAME = /Tôi đã đọc và đồng ý/;
const PASSWORD = 'StrongPassword123!';

function uniqueEmail(label: string): string {
  return `learner.consent.${label}.${Date.now()}.${Math.floor(Math.random() * 10_000)}@example.test`;
}

// Own client IP: the suite loads /sign-up often from one address, and the
// page's public legal read is throttled per IP (60/min).
async function ownClientIp(page: Page): Promise<void> {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  await page.setExtraHTTPHeaders({
    'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}`,
  });
}

async function fillCredentials(page: Page, email: string): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD);
}

test.describe('sign-up legal checkbox (M1.7b2, Q188)', () => {
  test('keeps the button disabled until ticked and sends no versions while none exists', async ({
    page,
  }) => {
    await ownClientIp(page);
    await page.goto('/sign-up');
    const checkbox = page.getByRole('checkbox', { name: CONSENT_NAME });
    const submit = page.getByRole('button', { name: 'Tạo tài khoản' });
    await expect(checkbox).not.toBeChecked();
    await expect(submit).toBeDisabled();
    await expect(
      page.getByRole('link', { name: 'Điều khoản sử dụng' }),
    ).toHaveAttribute('href', '/terms');
    await expect(
      page.getByRole('link', { name: 'Chính sách bảo mật' }),
    ).toHaveAttribute('href', '/privacy');

    await fillCredentials(page, uniqueEmail('none'));
    await expect(submit).toBeDisabled();
    await checkbox.check();
    await expect(submit).toBeEnabled();

    const registerRequest = page.waitForRequest(
      '**/api/learner/session/register',
    );
    await submit.click();
    const body = (await registerRequest).postDataJSON() as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('acceptedDocuments');
    await expect(page).toHaveURL(/\/onboarding|\/learn/);
  });

  test('records signup consent for the current versions', async ({ page }) => {
    disposableDbUrl();
    const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    // Own prefix, removed in `finally` so no other spec ever sees a version.
    const prefix = `pw-c-${stamp}-`;
    const documents = (['terms', 'privacy'] as const).map((type) => ({
      type,
      version: `${prefix}${type[0]}`,
      sha256: createHash('sha256').update(`${prefix}${type}`).digest('hex'),
    }));
    const email = uniqueEmail('versions');
    try {
      queryDisposableDb(
        [
          'INSERT INTO "LegalDocumentVersion" ("type", "version", "sha256", "effectiveAt") VALUES',
          documents
            .map(
              (d) =>
                `(${sqlLiteral(d.type)}::"LegalDocumentType", ${sqlLiteral(d.version)}, ${sqlLiteral(d.sha256)}, now() - interval '1 day')`,
            )
            .join(', '),
          ';',
        ].join(' '),
      );

      await ownClientIp(page);
      await page.goto('/sign-up');
      await fillCredentials(page, email);
      const submit = page.getByRole('button', { name: 'Tạo tài khoản' });
      await expect(submit).toBeDisabled();
      await page.getByRole('checkbox', { name: CONSENT_NAME }).check();

      const registerResponse = page.waitForResponse(
        '**/api/learner/session/register',
      );
      await submit.click();
      const response = await registerResponse;
      expect(response.status()).toBe(201);
      expect(response.request().postDataJSON()).toMatchObject({
        acceptedDocuments: documents,
      });

      const rows = queryDisposableDb(
        [
          'SELECT c."type", c."consentVersion", c."documentSha256", c."channel"',
          'FROM "Consent" c JOIN "User" u ON c."userId" = u.id',
          `WHERE u.email = ${sqlLiteral(email)} ORDER BY c."type";`,
        ].join(' '),
      );
      expect(rows.split('\n')).toEqual(
        documents.map((d) => `${d.type}|${d.version}|${d.sha256}|signup`),
      );
    } finally {
      queryDisposableDb(
        `DELETE FROM "LegalDocumentVersion" WHERE "version" LIKE ${sqlLiteral(`${prefix}%`)};`,
      );
    }
  });
});
