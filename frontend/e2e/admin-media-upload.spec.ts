import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  backendLogin,
  readCspViolations,
  watchCsp,
} from './support/learner-fixtures';
import { queryDisposableDb, sqlLiteral } from './support/disposable-db';

/**
 * M5.2a — trang Tải media lên (TL-42, TL-45); M5.2b — nghe/xem trước (TL-55).
 *
 * Guard 5 lần/phút/admin đếm cả request bị từ chối (cms.controller.ts), nên
 * request upload thật tới backend CHỈ chạy ở desktop-1440: 3 upload / admin
 * chính ((1), (1b), (2)) + 1 upload / admin phụ ((1c), TL-57), chỉ
 * desktop-1440. Backend Playwright chạy MEDIA_INGESTION_ENABLED=true; cờ tắt
 * và "không nguồn" kiểm ở unit.
 */

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin.frontend@example.test';
const adminPassword =
  process.env.E2E_ADMIN_PASSWORD ?? 'FrontendTest-Admin-123';
const mediaAdminEmail =
  process.env.E2E_MEDIA_ADMIN_EMAIL ?? 'admin.media.frontend@example.test';
const mediaAdminPassword =
  process.env.E2E_MEDIA_ADMIN_PASSWORD ?? 'FrontendTest-MediaAdmin-123';
// PNG 32×32 RGB màu xanh đặc (V3: đủ lớn để thấy trong khung xem trước).
const PNG_32X32 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR42mNQTX5NU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAMMtzEyPwvGEAAAAAElFTkSuQmCC',
  'base64',
);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3200';
const origin = new URL(baseURL).origin;
const LICENSED_CODE = 'FRONTEND_CONSOLE_V1';
const UNLICENSED_CODE = 'FRONTEND_CONSOLE_UNLICENSED';
const UPLOAD_URL = '/api/admin/media/ingestions';
const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;

function skipUnlessUploadProject(testInfo: TestInfo) {
  test.skip(
    testInfo.project.name !== 'desktop-1440',
    'upload thật chỉ ở desktop-1440: rate limit 5/phút/admin',
  );
}

/** WAV PCM 16-bit mono 8 kHz im lặng; mặc định 0,1 giây. */
function wavBytes(total = 44 + 1600): Buffer {
  const data = total - 44;
  const buffer = Buffer.alloc(44 + data);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + data, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(data, 40);
  return buffer;
}

async function loginAsAdmin(
  page: Page,
  email = adminEmail,
  password = adminPassword,
) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL(/\/(admin\/|forbidden)/u);
}

async function openUpload(page: Page) {
  await loginAsAdmin(page);
  await page.goto('/admin/media/upload');
  await expect(
    page.getByRole('heading', { name: 'Tải media lên', level: 1 }),
  ).toBeVisible();
}

function sourceId(code: string): number {
  return Number(
    queryDisposableDb(
      `SELECT id FROM "DataSource" WHERE code = ${sqlLiteral(code)}`,
    ),
  );
}

async function chooseSource(page: Page) {
  await page
    .getByLabel('Nguồn dữ liệu *')
    .selectOption(String(sourceId(LICENSED_CODE)));
}

async function chooseFile(
  page: Page,
  name: string,
  mimeType: string,
  total?: number,
) {
  await page.setInputFiles('#media-file', {
    name,
    mimeType,
    buffer: wavBytes(total),
  });
}

test.describe('Admin tải media (M5.2a)', () => {
  test('(1) WAV hợp lệ → thành công, "Xem chi tiết" mở đúng media', async ({
    page,
  }, testInfo) => {
    skipUnlessUploadProject(testInfo);
    await openUpload(page);
    await chooseSource(page);
    const filename = `bai${suffix}.wav`;
    await chooseFile(page, filename, 'audio/x-wav');

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(UPLOAD_URL) &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Tải lên' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const body = (await response.json()) as {
      data: { media: { id: number } };
    };
    const mediaId = body.data.media.id;

    await expect(
      page.getByText(`Đã tải lên ${filename}. Trạng thái: Sẵn sàng.`),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Xem chi tiết' }).click();
    await page.waitForURL(new RegExp(`/admin/media/${mediaId}$`, 'u'));
    await expect(page.getByText(filename).first()).toBeVisible();

    // TL-55: nghe thử chỉ lấy grant khi bấm, không tự phát.
    const access = page.waitForResponse((item) =>
      item.url().endsWith(`/api/admin/media/${mediaId}/access`),
    );
    await page.getByRole('button', { name: 'Nghe thử' }).click();
    expect((await access).status()).toBe(200);
    const audio = page.locator('.adm-media-preview audio');
    await expect(audio).toHaveCount(1);
    // Lồng sai CSS từng làm <audio> co về 0 px: kiểm thấy được thật.
    await expect(audio).toBeVisible();
    const state = await audio.evaluate((element: HTMLAudioElement) => ({
      preload: element.getAttribute('preload'),
      autoplay: element.autoplay,
      paused: element.paused,
      src: element.getAttribute('src') ?? '',
    }));
    expect(state).toMatchObject({
      preload: 'none',
      autoplay: false,
      paused: true,
    });
    expect(state.src.startsWith(`/api/admin/media/${mediaId}/content?`)).toBe(
      true,
    );
    // Same-origin fetch from the page sends the session cookie like <audio>.
    const fetched = await page.evaluate(async (src) => {
      const full = await fetch(src);
      const ranged = await fetch(src, { headers: { range: 'bytes=0-1' } });
      return {
        status: full.status,
        type: full.headers.get('content-type'),
        rangedStatus: ranged.status,
      };
    }, state.src);
    expect(fetched).toEqual({
      status: 200,
      type: 'audio/wav',
      rangedStatus: 206,
    });
  });

  test('(1c) admin phụ tải PNG 1×1 → chi tiết hiện ảnh xem trước', async ({
    page,
  }, testInfo) => {
    skipUnlessUploadProject(testInfo);
    await loginAsAdmin(page, mediaAdminEmail, mediaAdminPassword);
    await page.goto('/admin/media/upload');
    await chooseSource(page);
    const filename = `xemtruoc${suffix}.png`;
    await page.setInputFiles('#media-file', {
      name: filename,
      mimeType: 'image/png',
      buffer: PNG_32X32,
    });
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(UPLOAD_URL) &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Tải lên' }).click();
    expect((await responsePromise).status()).toBe(201);
    await page.getByRole('link', { name: 'Xem chi tiết' }).click();
    const image = page.getByRole('img', { name: `Xem trước ${filename}` });
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBeGreaterThanOrEqual(32);
  });

  test('(1b) WAV 10 485 700 byte (sát giới hạn 10 MiB) → thành công qua proxy/BFF', async ({
    page,
  }, testInfo) => {
    skipUnlessUploadProject(testInfo);
    await openUpload(page);
    await chooseSource(page);
    const filename = `lon${suffix}.wav`;
    await chooseFile(page, filename, 'audio/wav', 10_485_700);
    await expect(page.getByText('10,0 MB')).toBeVisible();

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(UPLOAD_URL) &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Tải lên' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const body = (await response.json()) as {
      data: { media: { size: number } };
    };
    expect(body.data.media.size).toBe(10_485_700);
    await expect(page.getByText(`Đã tải lên ${filename}.`)).toBeVisible();
  });

  test('(2) tên .png chứa byte WAV → 422 MIME_SIGNATURE_MISMATCH câu tiếng Việt', async ({
    page,
  }, testInfo) => {
    skipUnlessUploadProject(testInfo);
    await openUpload(page);
    await chooseSource(page);
    await chooseFile(page, `anh${suffix}.png`, 'image/png');

    const responsePromise = page.waitForResponse((response) =>
      response.url().includes(UPLOAD_URL),
    );
    await page.getByRole('button', { name: 'Tải lên' }).click();
    const response = await responsePromise;
    // Backend so MIME khai báo với chữ ký trước khi kiểm đuôi tên tệp.
    expect(response.status()).toBe(422);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe('MIME_SIGNATURE_MISMATCH');
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Nội dung tệp không khớp với loại tệp.',
    );
  });

  test('(3) "bai.1.wav" và "anh.jpeg" bị chặn ở client, không gọi upload', async ({
    page,
  }) => {
    await openUpload(page);
    await chooseSource(page);
    let uploads = 0;
    page.on('request', (request) => {
      if (request.url().includes(UPLOAD_URL)) uploads += 1;
    });

    await chooseFile(page, 'bai.1.wav', 'audio/wav');
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'đúng một dấu chấm',
    );
    await expect(page.getByRole('button', { name: 'Tải lên' })).toBeDisabled();

    await chooseFile(page, 'anh.jpeg', 'image/jpeg');
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Đổi đuôi tệp thành .jpg',
    );
    await expect(page.getByRole('button', { name: 'Tải lên' })).toBeDisabled();
    expect(uploads).toBe(0);
  });

  test('(4) BFF: Origin sai 403, thiếu key 400, content-type sai 415', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);
    const session = await backendLogin(request, adminEmail, adminPassword);
    const url = `${origin}${UPLOAD_URL}?dataSourceId=${sourceId(LICENSED_CODE)}`;
    const multipart = {
      file: { name: 'bai1.wav', mimeType: 'audio/wav', buffer: wavBytes() },
    };
    const cookie = `hsk_admin_session=${session}`;

    const cross = await request.post(url, {
      headers: { origin: 'https://attacker.example', cookie },
      multipart,
    });
    expect(cross.status()).toBe(403);

    const missingKey = await request.post(url, {
      headers: { origin, cookie },
      multipart,
    });
    expect(missingKey.status()).toBe(400);
    expect(
      ((await missingKey.json()) as { error: { code: string } }).error.code,
    ).toBe('INVALID_IDEMPOTENCY_KEY');

    const wrongType = await request.post(url, {
      headers: {
        origin,
        cookie,
        'idempotency-key': crypto.randomUUID(),
        'content-type': 'application/json',
      },
      data: '{}',
    });
    expect(wrongType.status()).toBe(415);
  });

  test('(5) /admin/media có link "Tải lên"; ô nguồn chỉ có nguồn đủ giấy phép', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/media');
    const link = page.getByRole('link', { name: 'Tải lên', exact: true });
    await expect(link).toHaveAttribute('href', '/admin/media/upload');
    await link.click();
    await page.waitForURL(/\/admin\/media\/upload$/u);

    const select = page.getByLabel('Nguồn dữ liệu *');
    await expect(
      select.locator(`option[value="${sourceId(LICENSED_CODE)}"]`),
    ).toHaveCount(1);
    await expect(
      select.locator(`option[value="${sourceId(UNLICENSED_CODE)}"]`),
    ).toHaveCount(0);
    await expect(select).not.toContainText(UNLICENSED_CODE);
  });

  test('(6) axe 0 vi phạm; 390px không cuộn ngang; không vi phạm CSP', async ({
    page,
  }, testInfo) => {
    const consoleViolations = await watchCsp(page);
    await openUpload(page);

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
});
