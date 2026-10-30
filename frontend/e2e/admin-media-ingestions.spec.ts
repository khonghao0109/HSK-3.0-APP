import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  backendLogin,
  readCspViolations,
  watchCsp,
} from './support/learner-fixtures';
import { queryDisposableDb, sqlLiteral } from './support/disposable-db';

/**
 * M5.2b — trang Tải lên cần xử lý (Q106, TL-46…TL-58). Không upload: mọi lượt
 * tải được seed bằng SQL (TL-58). MediaIngestion không xoá được (trigger), nên
 * mỗi test dùng hậu tố riêng và tìm thẻ theo tên tệp, không theo vị trí hay
 * tổng số. Mỗi project để lại tối đa 2 bản ghi có vấn đề (I1, I8); I2/I3 dọn
 * xong bản ghi của chính mình.
 */

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin.frontend@example.test';
const adminPassword =
  process.env.E2E_ADMIN_PASSWORD ?? 'FrontendTest-Admin-123';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3200';
const origin = new URL(baseURL).origin;
const SOURCE_CODE = 'FRONTEND_CONSOLE_V1';
// = InMemoryObjectStorageAdapter.provider; cleanupAvailable so sánh provider.
const MEMORY_PROVIDER = 'memory-test';
const PAGE_URL = '/admin/media/ingestions';
const run = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;

type Seeded = { id: number; filename: string };

/**
 * Một lệnh, một giao dịch. Múi phiên quyết định giá trị trigger ghi bằng
 * CURRENT_TIMESTAMP: 'UTC' như backend; 'Etc/GMT+2' làm cột timestamp sớm hơn
 * 2 giờ, nên với backend bản ghi processing đã kẹt quá 15 phút (TL-48).
 */
function seedIngestion(
  tag: string,
  kind: 'cleanup_required' | 'processing' | 'stuck' | 'failed',
): Seeded {
  const filename = `m52b-${tag}-${run}.png`;
  const name = sqlLiteral(filename);
  const timeZone = kind === 'stuck' ? 'Etc/GMT+2' : 'UTC';
  const followUp = {
    processing: '',
    stuck: '',
    failed: `UPDATE "MediaIngestion" SET status = 'failed', "failureCode" = 'STORAGE_WRITE_FAILED' WHERE id = new_id;`,
    cleanup_required: `
      UPDATE "MediaIngestion"
        SET status = 'cleanup_required',
            "failureCode" = 'OBJECT_WRITE_OUTCOME_UNKNOWN',
            "storageKey" = 'media/' || to_char(CURRENT_TIMESTAMP, 'YYYY/MM') || '/' || replace(gen_random_uuid()::text, '-', '') || '.png'
        WHERE id = new_id;
      INSERT INTO "AuditLog" ("actorId", action, "targetType", "targetId", "afterSummary", "createdAt")
        SELECT actor, 'media.ingestion_failed', 'media_ingestion', id::text,
          jsonb_build_object('ingestionId', id, 'status', 'cleanup_required', 'failureCode', 'OBJECT_WRITE_OUTCOME_UNKNOWN'),
          "cleanupRequiredAt"
        FROM "MediaIngestion" WHERE id = new_id;`,
  }[kind];
  const id = queryDisposableDb(`
    DO $$
    DECLARE
      actor integer;
      new_id integer;
    BEGIN
      PERFORM set_config('TimeZone', ${sqlLiteral(timeZone)}, true);
      SELECT id INTO STRICT actor FROM "User" WHERE email = ${sqlLiteral(adminEmail)};
      INSERT INTO "MediaIngestion" (
        "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint", status,
        "originalFilename", "declaredMimeType", size, "storageProvider",
        "attemptCount", "processingToken", "updatedAt"
      )
      SELECT actor, d.id, encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'),
        repeat('c', 64), 'processing', ${name}, 'image/png', 2048,
        ${sqlLiteral(MEMORY_PROVIDER)}, 1, gen_random_uuid()::text, CURRENT_TIMESTAMP
      FROM "DataSource" d WHERE d.code = ${sqlLiteral(SOURCE_CODE)}
      RETURNING id INTO STRICT new_id;
      ${followUp}
    END
    $$;
    SELECT id FROM "MediaIngestion" WHERE "originalFilename" = ${name};
  `);
  // psql -At also prints the DO command tag; the id is the last line.
  return { id: Number(id.split('\n').pop()), filename };
}

function ingestionState(id: number): string {
  return queryDisposableDb(
    `SELECT status || '|' || coalesce("failureCode", '') FROM "MediaIngestion" WHERE id = ${id}`,
  );
}

/** Như backend/test/media-ingestion.e2e-spec.ts: hết cửa sổ settling 1 phút. */
function ageCleanupObservation(id: number) {
  queryDisposableDb(`
    UPDATE "MediaIngestion"
      SET "cleanupAbsentObservedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '2 minutes'
      WHERE id = ${id}
  `);
}

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Mật khẩu').fill(adminPassword);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL(/\/(admin\/|forbidden)/u);
}

async function openIngestions(page: Page) {
  await loginAsAdmin(page);
  await page.goto(PAGE_URL);
  await expect(
    page.getByRole('heading', { name: 'Tải lên cần xử lý', level: 1 }),
  ).toBeVisible();
}

function card(page: Page, filename: string) {
  return page.locator('.adm-ingestion').filter({ hasText: filename });
}

test.describe('Admin tải lên cần xử lý (M5.2b)', () => {
  test('I1 thẻ cần dọn dẹp có badge, nhãn lỗi, nguồn, nút Dọn dẹp; đối chứng không hiện', async ({
    page,
  }) => {
    const target = seedIngestion('i1', 'cleanup_required');
    const fresh = seedIngestion('i1-fresh', 'processing');
    const failed = seedIngestion('i1-failed', 'failed');
    await openIngestions(page);
    const item = card(page, target.filename);
    await expect(item).toHaveCount(1);
    await expect(item.getByText('Cần dọn dẹp')).toBeVisible();
    await expect(item.getByText('Không rõ kết quả ghi tệp')).toBeVisible();
    await expect(item.getByText(`${SOURCE_CODE} · 2026.08`)).toBeVisible();
    await expect(
      item.getByText(String(target.id), { exact: true }),
    ).toBeVisible();
    await expect(item.getByRole('button', { name: 'Dọn dẹp' })).toBeVisible();
    await expect(card(page, fresh.filename)).toHaveCount(0);
    await expect(card(page, failed.filename)).toHaveCount(0);
  });

  test('I2 Dọn dẹp → settling → làm già quan sát → Dọn dẹp lại → hoàn tất', async ({
    page,
  }) => {
    const target = seedIngestion('i2', 'cleanup_required');
    await openIngestions(page);
    await card(page, target.filename)
      .getByRole('button', { name: 'Dọn dẹp' })
      .click();
    await expect(
      page.getByText(
        `Bản ghi #${target.id}: tệp không còn trong storage. Bấm Dọn dẹp lại sau ít nhất 1 phút để hoàn tất.`,
      ),
    ).toBeVisible();
    const item = card(page, target.filename);
    await expect(item.getByText('Đang chờ xác nhận tệp đã xoá')).toBeVisible();
    await expect(item.getByRole('button', { name: 'Dọn dẹp' })).toBeFocused();

    ageCleanupObservation(target.id);
    await item.getByRole('button', { name: 'Dọn dẹp' }).click();
    await expect(
      page.getByText(`Đã dọn dẹp bản ghi #${target.id}.`),
    ).toBeVisible();
    await expect(card(page, target.filename)).toHaveCount(0);
    expect(ingestionState(target.id)).toBe('failed|OBJECT_CLEANED');
    expect(
      queryDisposableDb(
        `SELECT count(*) FROM "AuditLog" WHERE action = 'media.ingestion_cleanup_completed' AND "targetType" = 'media_ingestion' AND "targetId" = '${target.id}'`,
      ),
    ).toBe('1');
  });

  test('I3 bản ghi đã dọn trước khi bấm → 409, câu và làm mới', async ({
    page,
    request,
  }) => {
    const target = seedIngestion('i3', 'cleanup_required');
    await openIngestions(page);
    await expect(card(page, target.filename)).toHaveCount(1);

    const session = await backendLogin(request, adminEmail, adminPassword);
    const cleanupUrl = `${origin}/api/admin/media/ingestions/${target.id}/cleanup`;
    const headers = { origin, cookie: `hsk_admin_session=${session}` };
    expect((await request.post(cleanupUrl, { headers })).status()).toBe(201);
    ageCleanupObservation(target.id);
    expect((await request.post(cleanupUrl, { headers })).status()).toBe(201);
    expect(ingestionState(target.id)).toBe('failed|OBJECT_CLEANED');

    const response = page.waitForResponse((item) =>
      item.url().endsWith(`/api/admin/media/ingestions/${target.id}/cleanup`),
    );
    await card(page, target.filename)
      .getByRole('button', { name: 'Dọn dẹp' })
      .click();
    expect((await response).status()).toBe(409);
    await expect(
      page.getByText(
        `Bản ghi #${target.id} đã thay đổi hoặc đang được dọn. Danh sách đã được làm mới.`,
      ),
    ).toBeVisible();
    await expect(card(page, target.filename)).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Danh sách tải lên' }),
    ).toBeFocused();
  });

  test('I4 BFF dọn dẹp: Origin sai 403, id "abc" 400, thiếu cookie 401', async ({
    request,
  }) => {
    const session = await backendLogin(request, adminEmail, adminPassword);
    const cookie = `hsk_admin_session=${session}`;
    const cross = await request.post(
      `${origin}/api/admin/media/ingestions/1/cleanup`,
      { headers: { origin: 'https://attacker.example', cookie } },
    );
    expect(cross.status()).toBe(403);
    const badId = await request.post(
      `${origin}/api/admin/media/ingestions/abc/cleanup`,
      { headers: { origin, cookie } },
    );
    expect(badId.status()).toBe(400);
    const anonymous = await request.post(
      `${origin}/api/admin/media/ingestions/1/cleanup`,
      { headers: { origin } },
    );
    expect(anonymous.status()).toBe(401);
  });

  test('I5 link "Tải lên cần xử lý" từ Thư viện media; sidebar giữ aria-current', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/media');
    await page.getByRole('link', { name: 'Tải lên cần xử lý' }).click();
    await page.waitForURL(/\/admin\/media\/ingestions$/u);
    await expect(
      page.getByRole('heading', { name: 'Tải lên cần xử lý', level: 1 }),
    ).toBeVisible();
    await expect(
      page.locator('.adm-nav__item[aria-current="page"]'),
    ).toHaveText(/Thư viện media/u);
  });

  test('I6 chi tiết legacy-handout.pdf: câu không xem trước, không gọi /access', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const id = queryDisposableDb(
      `SELECT id FROM "Media" WHERE "originalFilename" = 'legacy-handout.pdf'`,
    );
    const accessCalls: string[] = [];
    page.on('request', (item) => {
      if (item.url().includes('/access')) accessCalls.push(item.url());
    });
    await page.goto(`/admin/media/${id}`);
    await expect(
      page.getByText(
        'Không xem trước được: chỉ media sẵn sàng, đang dùng, định dạng JPG/PNG/MP3/WAV.',
      ),
    ).toBeVisible();
    // N3: an /access call could only come from hydrated client code.
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('button, a')).some((element) =>
        Object.keys(element).some((key) => key.startsWith('__reactFiber')),
      ),
    );
    await page.waitForTimeout(500);
    expect(accessCalls).toEqual([]);
  });

  test('I7 axe 0 vi phạm; 390px không cuộn ngang; không vi phạm CSP', async ({
    page,
  }, testInfo) => {
    const consoleViolations = await watchCsp(page);
    await openIngestions(page);
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations).toEqual([]);
    const metrics = await page.evaluate(() => ({
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    if (testInfo.project.name === 'mobile-390') {
      expect(metrics.html, JSON.stringify(metrics)).toBeLessThanOrEqual(
        metrics.innerWidth,
      );
      expect(metrics.body, JSON.stringify(metrics)).toBeLessThanOrEqual(
        metrics.innerWidth,
      );
    }
    expect(await readCspViolations(page)).toEqual([]);
    expect(
      consoleViolations.filter((item) =>
        item.includes('Content Security Policy'),
      ),
    ).toEqual([]);
  });

  test('I8 bản ghi kẹt xử lý: badge "Kẹt xử lý", không nút, câu liên hệ vận hành', async ({
    page,
  }) => {
    const stuck = seedIngestion('i8', 'stuck');
    await openIngestions(page);
    const item = card(page, stuck.filename);
    await expect(item).toHaveCount(1);
    await expect(item.getByText('Kẹt xử lý')).toBeVisible();
    await expect(item.getByText('Bắt đầu xử lý')).toBeVisible();
    await expect(item.getByRole('button')).toHaveCount(0);
    await expect(
      item.getByText('Liên hệ vận hành để đối soát thủ công.'),
    ).toBeVisible();
  });
});
