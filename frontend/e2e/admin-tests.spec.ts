import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { queryDisposableDb, sqlLiteral } from './support/disposable-db';

/**
 * M4.1b — Trình xây dựng đề thi (TL-107/TL-108/TL-109).
 *
 * Seed bằng SQL theo project (`prefix` riêng cho từng viewport) nên bốn project
 * chạy tuần tự trên cùng database disposable không đụng nhau. Không dùng
 * `.skip`/`.only`; case chỉ dành cho một viewport `return` sớm.
 */

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin.frontend@example.test';
const adminPassword =
  process.env.E2E_ADMIN_PASSWORD ?? 'FrontendTest-Admin-123';
const LEVEL_CODE = 'HSK3';

let prefix = 'm41b';
let levelIdValue = 0;
let publishedReadingId = 0;
let publishedListeningId = 0;
let draftQuestionId = 0;
let draftTestId = 0;
let archivedTestId = 0;

type PageIssue = { kind: 'console' | 'pageerror'; text: string; url: string };

function queryNumber(sql: string): number {
  const value = Number(queryDisposableDb(sql));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Expected a numeric id from SQL, got "${String(value)}".`);
  }
  return value;
}

function findId(sql: string): number | null {
  const raw = queryDisposableDb(sql).trim();
  if (raw.length === 0) return null;
  const first = Number(raw.split('\n')[0]);
  return Number.isSafeInteger(first) && first > 0 ? first : null;
}

function adminId(): number {
  return queryNumber(
    `SELECT id FROM "User" WHERE email = ${sqlLiteral(adminEmail)}`,
  );
}

function levelId(): number {
  if (levelIdValue > 0) return levelIdValue;
  levelIdValue = queryNumber(
    `SELECT id FROM "Level" WHERE code = ${sqlLiteral(LEVEL_CODE)}`,
  );
  return levelIdValue;
}

function seedQuestion(input: {
  content: string;
  skill: 'listening' | 'reading';
  status: 'draft' | 'published';
}): number {
  const existing = findId(
    `SELECT id FROM "Question" WHERE content = ${sqlLiteral(input.content)} ORDER BY id LIMIT 1`,
  );
  if (existing !== null) return existing;
  const author = adminId();
  const answers = JSON.stringify({
    options: [
      { id: 'seed-a', text: 'Xin chào' },
      { id: 'seed-b', text: 'Tạm biệt' },
    ],
  });
  const correct = JSON.stringify({ optionId: 'seed-a' });
  return queryNumber(`
    WITH ins AS (
      INSERT INTO "Question" (
        "content", "type", "skill", "answers", "correctAnswer", "explanation",
        "levelId", "difficulty", "version", "contentHash", "status",
        "publishedAt", "publishedById", "createdById", "updatedById",
        "createdAt", "updatedAt"
      ) VALUES (
        ${sqlLiteral(input.content)},
        'mcq'::"QuestionType",
        ${sqlLiteral(input.skill)}::"Skill",
        ${sqlLiteral(answers)}::jsonb,
        ${sqlLiteral(correct)}::jsonb,
        'Giải thích cho câu hỏi seed.',
        ${levelId()},
        2,
        1,
        ${sqlLiteral('a'.repeat(64))},
        ${sqlLiteral(input.status)}::"ContentStatus",
        ${input.status === 'published' ? "(now() AT TIME ZONE 'UTC')" : 'NULL'},
        ${input.status === 'published' ? String(author) : 'NULL'},
        ${author},
        ${author},
        (now() AT TIME ZONE 'UTC'),
        (now() AT TIME ZONE 'UTC')
      )
      RETURNING "id"
    ) SELECT "id" FROM ins
  `);
}

function seedAudio(): number {
  const url = `https://cdn.example.test/m41b/${prefix}/audio.mp3`;
  const existing = findId(
    `SELECT id FROM "Media" WHERE url = ${sqlLiteral(url)} LIMIT 1`,
  );
  if (existing !== null) return existing;
  const author = adminId();
  return queryNumber(`
    WITH ins AS (
      INSERT INTO "Media" (
        "url", "type", "mimeType", "duration", "processingStatus",
        "originalFilename", "uploadedById", "updatedById", "createdAt", "updatedAt"
      ) VALUES (
        ${sqlLiteral(url)}, 'audio'::"MediaType", 'audio/mpeg', 6,
        'ready'::"MediaProcessingStatus", 'm41b-audio.mp3',
        ${author}, ${author}, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
      )
      RETURNING "id"
    ) SELECT "id" FROM ins
  `);
}

function seedTest(input: {
  title: string;
  status: 'draft' | 'published' | 'archived';
  duration?: number;
  passScore?: number | null;
}): number {
  const existing = findId(
    `SELECT id FROM "Test" WHERE title = ${sqlLiteral(input.title)} ORDER BY id LIMIT 1`,
  );
  if (existing !== null) return existing;
  const author = adminId();
  const publishedAt =
    input.status === 'published' ? "(now() AT TIME ZONE 'UTC')" : 'NULL';
  const deletedAt =
    input.status === 'archived' ? "(now() AT TIME ZONE 'UTC')" : 'NULL';
  return queryNumber(`
    WITH ins AS (
      INSERT INTO "Test" (
        "levelId", "title", "duration", "passScore", "status", "version",
        "publishedAt", "publishedById", "createdById", "updatedById",
        "deletedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${levelId()},
        ${sqlLiteral(input.title)},
        ${String(input.duration ?? 35)},
        ${input.passScore === undefined || input.passScore === null ? 'NULL' : String(input.passScore)},
        ${sqlLiteral(input.status)}::"ContentStatus",
        1,
        ${publishedAt},
        ${input.status === 'published' ? String(author) : 'NULL'},
        ${author},
        ${author},
        ${deletedAt},
        (now() AT TIME ZONE 'UTC'),
        (now() AT TIME ZONE 'UTC')
      )
      RETURNING "id"
    ) SELECT "id" FROM ins
  `);
}

/** Phần + nhóm rỗng (chỉ publish được sau khi seed vì PUT structure đòi câu). */
function seedEmptyStructure(testId: number): void {
  const sectionId = queryNumber(`
    WITH ins AS (
      INSERT INTO "TestSection" ("testId", "skill", "title", "orderIndex", "createdAt", "updatedAt")
      VALUES (${testId}, 'reading'::"Skill", ${sqlLiteral(`${prefix} Phần rỗng`)}, 1, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      RETURNING "id"
    ) SELECT "id" FROM ins
  `);
  queryDisposableDb(`
    INSERT INTO "QuestionGroup" ("testId", "sectionId", "title", "orderIndex", "createdAt", "updatedAt")
    VALUES (${testId}, ${sectionId}, ${sqlLiteral(`${prefix} Nhóm rỗng`)}, 1, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
  `);
}

/** Đề chỉ có phần (không câu) với 4 kỹ năng khác nhau — kiểm cột Kỹ năng. */
function seedTestWithSkills(title: string): number {
  const existing = findId(
    `SELECT id FROM "Test" WHERE title = ${sqlLiteral(title)} ORDER BY id LIMIT 1`,
  );
  if (existing !== null) return existing;
  const testId = seedTest({ title, status: 'draft', duration: 35 });
  const skills = ['listening', 'reading', 'writing', 'speaking'];
  for (const [index, skill] of skills.entries()) {
    queryDisposableDb(`
      INSERT INTO "TestSection" ("testId", "skill", "title", "orderIndex", "createdAt", "updatedAt")
      VALUES (${testId}, ${sqlLiteral(skill)}::"Skill", ${sqlLiteral(`${title} phần ${String(index + 1)}`)}, ${String(index + 1)}, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
    `);
  }
  return testId;
}

/** Phần → nhóm → câu đã xuất bản, đủ điều kiện publish (dùng cho T4/T5). */
function seedStructureWithQuestion(testId: number, questionId: number): void {
  const sectionId = queryNumber(`
    WITH ins AS (
      INSERT INTO "TestSection" ("testId", "skill", "title", "orderIndex", "createdAt", "updatedAt")
      VALUES (${testId}, 'reading'::"Skill", ${sqlLiteral(`${prefix} Phần có câu`)}, 1, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      RETURNING "id"
    ) SELECT "id" FROM ins
  `);
  const groupId = queryNumber(`
    WITH ins AS (
      INSERT INTO "QuestionGroup" ("testId", "sectionId", "title", "orderIndex", "createdAt", "updatedAt")
      VALUES (${testId}, ${sectionId}, ${sqlLiteral(`${prefix} Nhóm có câu`)}, 1, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      RETURNING "id"
    ) SELECT "id" FROM ins
  `);
  const testQuestionId = queryNumber(`
    WITH ins AS (
      INSERT INTO "TestQuestion" ("testId", "questionId", "orderIndex")
      VALUES (${testId}, ${questionId}, 1)
      RETURNING "id"
    ) SELECT "id" FROM ins
  `);
  queryDisposableDb(`
    INSERT INTO "TestQuestionPlacement" ("testQuestionId", "testId", "sectionId", "groupId", "orderIndex")
    VALUES (${testQuestionId}, ${testId}, ${sectionId}, ${groupId}, 1)
  `);
}

/** 2 phần (reading + listening), mỗi phần 1 nhóm 1 câu — dùng cho U4/C3. */
function seedStructurePreservingDraft(
  testId: number,
  readingQuestionId: number,
  listeningQuestionId: number,
): void {
  const sections: Array<[string, string, number]> = [
    ['reading', `${prefix} Phần đọc U4`, readingQuestionId],
    ['listening', `${prefix} Phần nghe U4`, listeningQuestionId],
  ];
  sections.forEach(([skill, title, questionId], index) => {
    const orderIndex = index + 1;
    const sectionId = queryNumber(`
      WITH ins AS (
        INSERT INTO "TestSection" ("testId", "skill", "title", "orderIndex", "createdAt", "updatedAt")
        VALUES (${testId}, ${sqlLiteral(skill)}::"Skill", ${sqlLiteral(title)}, ${String(orderIndex)}, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
        RETURNING "id"
      ) SELECT "id" FROM ins
    `);
    const groupId = queryNumber(`
      WITH ins AS (
        INSERT INTO "QuestionGroup" ("testId", "sectionId", "title", "orderIndex", "createdAt", "updatedAt")
        VALUES (${testId}, ${sectionId}, ${sqlLiteral(`Nhóm ${String(orderIndex)}`)}, 1, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
        RETURNING "id"
      ) SELECT "id" FROM ins
    `);
    const testQuestionId = queryNumber(`
      WITH ins AS (
        INSERT INTO "TestQuestion" ("testId", "questionId", "orderIndex")
        VALUES (${testId}, ${questionId}, ${String(orderIndex)})
        RETURNING "id"
      ) SELECT "id" FROM ins
    `);
    queryDisposableDb(`
      INSERT INTO "TestQuestionPlacement" ("testQuestionId", "testId", "sectionId", "groupId", "orderIndex")
      VALUES (${testQuestionId}, ${testId}, ${sectionId}, ${groupId}, ${String(orderIndex)})
    `);
  });
}

function testTitle(label: string): string {
  return `${prefix} ${label}`;
}

/** Tạo đề nháp qua form TL-107 rồi chờ builder của đề mới. */
async function createDraftTest(
  page: Page,
  label: string,
  options: { passScore?: string } = {},
): Promise<number> {
  await page.goto('/admin/tests/new');
  await page.getByLabel('Cấp HSK').selectOption({ label: 'HSK 3' });
  await page.getByLabel('Tên đề').fill(testTitle(label));
  await page.getByLabel('Thời gian (phút)').fill('35');
  if (options.passScore !== undefined && options.passScore !== '') {
    await page.getByLabel('Điểm đỗ').fill(options.passScore);
  }
  await page.getByRole('button', { name: 'Tạo đề thi' }).click();
  await page.waitForURL(/\/admin\/tests\/\d+$/u);
  const match = /\/admin\/tests\/(\d+)$/u.exec(page.url());
  const testId = Number(match?.[1]);
  if (!Number.isSafeInteger(testId) || testId <= 0) {
    throw new Error(
      `createDraftTest did not land on a builder URL: ${page.url()}`,
    );
  }
  await expect(page.locator('.tst-panel')).toBeVisible();
  return testId;
}

/** Mở builder và chờ panel của đề (đúng cho cả đề nháp, published, archived). */
async function openBuilder(page: Page, testId: number): Promise<void> {
  await page.goto(`/admin/tests/${String(testId)}`);
  await expect(page.locator('.tst-panel')).toBeVisible();
}

/**
 * Chọn một câu trong bảng câu: lọc theo nội dung trước để câu nằm ở trang 1
 * (DB dùng chung giữa các lượt chạy), rồi tick checkbox exact.
 */
async function pickBankQuestion(
  page: Page,
  questionId: number,
  content: string,
): Promise<void> {
  await page.getByLabel('Tìm kiếm').fill(content);
  const checkbox = page.getByLabel(`Chọn câu Q${String(questionId)}`, {
    exact: true,
  });
  await expect(checkbox).toBeVisible();
  await checkbox.check();
}

/** Thêm một phần rồi đóng dialog để panel có section cho các assert sau. */
async function addSection(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Thêm phần' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Tên phần').fill(title);
  await dialog.getByRole('button', { name: 'Thêm phần' }).click();
  await expect(dialog).toBeHidden();
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Mật khẩu').fill(adminPassword);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL(/\/(admin\/|forbidden)/u);
}

async function openList(page: Page): Promise<void> {
  await page.goto('/admin/tests');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Đề thi' }),
  ).toBeVisible();
}

function collectIssues(page: Page): PageIssue[] {
  const issues: PageIssue[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      issues.push({
        kind: 'console',
        text: message.text(),
        url: message.location().url,
      });
    }
  });
  page.on('pageerror', (error) => {
    issues.push({ kind: 'pageerror', text: error.message, url: page.url() });
  });
  return issues;
}

function unexpectedIssues(
  issues: PageIssue[],
  allowed: (issue: PageIssue) => boolean,
): PageIssue[] {
  return issues.filter((issue) => !allowed(issue));
}

test.describe('Trình xây dựng đề thi (M4.1b)', () => {
  test.beforeAll(({}, testInfo) => {
    prefix = `m41b-${testInfo.project.name.replace(/[^a-z0-9]+/giu, '-')}`;
    levelIdValue = 0;
    publishedReadingId = seedQuestion({
      content: `${prefix} Câu đọc hiểu đã xuất bản`,
      skill: 'reading',
      status: 'published',
    });
    publishedListeningId = seedQuestion({
      content: `${prefix} Câu nghe hiểu đã xuất bản`,
      skill: 'listening',
      status: 'published',
    });
    draftQuestionId = seedQuestion({
      content: `${prefix} Câu nháp chưa xuất bản`,
      skill: 'reading',
      status: 'draft',
    });
    seedAudio();
    draftTestId = seedTest({
      title: testTitle('Đề nháp danh sách'),
      status: 'draft',
      duration: 35,
    });
    archivedTestId = seedTest({
      title: testTitle('Đề đã lưu trữ'),
      status: 'archived',
      duration: 40,
    });
  });

  test('T1: danh sách, lọc và mặc định ẩn đề lưu trữ', async ({
    page,
  }, testInfo) => {
    await loginAsAdmin(page);
    seedTestWithSkills(testTitle('Đề bốn kỹ năng'));
    // T1 tạo đề nháp riêng cho lần chạy này để trang 1 luôn chứa nó (DB dùng
    // chung giữa các lượt chạy, danh sách sắp theo updatedAt).
    const t1Title = `${testTitle('Đề nháp danh sách')} ${String(Date.now())}`;
    const t1DraftId = seedTest({
      title: t1Title,
      status: 'draft',
      duration: 35,
    });
    await openList(page);

    const visible = page.locator(
      `a[href="/admin/tests/${String(t1DraftId)}"]:visible`,
    );
    await expect(visible.first()).toBeVisible();
    await expect(
      page.locator(`a[href="/admin/tests/${String(archivedTestId)}"]:visible`),
    ).toHaveCount(0);

    // Lọc theo trạng thái Lưu trữ.
    await page.getByLabel('Trạng thái').selectOption('archived');
    await page.getByRole('button', { name: 'Lọc' }).click();
    await page.waitForURL(/status=archived/u);
    await expect(
      page
        .locator(`a[href="/admin/tests/${String(archivedTestId)}"]:visible`)
        .first(),
    ).toBeVisible();
    await expect(
      page.locator(`a[href="/admin/tests/${String(draftTestId)}"]:visible`),
    ).toHaveCount(0);

    // Tìm theo tên đề.
    await page.goto('/admin/tests');
    await page.getByLabel('Tìm theo tên đề').fill(t1Title);
    await page.getByRole('button', { name: 'Lọc' }).click();
    await page.waitForURL(/q=/u);
    await expect(
      page
        .locator(`a[href="/admin/tests/${String(t1DraftId)}"]:visible`)
        .first(),
    ).toBeVisible();

    // U2 (1440): ô cột Kỹ năng không tràn chữ và không đè cột bên cạnh.
    if (testInfo.project.name === 'desktop-1440') {
      await page.goto('/admin/tests');
      const skillCells = page.locator(
        '.tst-list-table tbody tr td:nth-child(4)',
      );
      const cellCount = await skillCells.count();
      expect(cellCount).toBeGreaterThan(0);
      for (let index = 0; index < cellCount; index += 1) {
        const cell = skillCells.nth(index);
        const metrics = await cell.evaluate((element) => {
          const next = element.nextElementSibling;
          return {
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            right: element.getBoundingClientRect().right,
            nextLeft: next ? next.getBoundingClientRect().left : null,
          };
        });
        expect(metrics.scrollWidth).toBeLessThanOrEqual(
          metrics.clientWidth + 1,
        );
        if (metrics.nextLeft !== null) {
          expect(metrics.right).toBeLessThanOrEqual(metrics.nextLeft + 1);
        }
      }
    }

    // U3 (390): ô tìm kiếm cao bằng input khác (≤ 3rem), không bị flex giãn.
    if (testInfo.project.name === 'mobile-390') {
      const searchBox = await page.locator('#tst-q').boundingBox();
      expect(searchBox).not.toBeNull();
      if (searchBox) expect(searchBox.height).toBeLessThanOrEqual(48);
    }
  });

  test('T2: tạo đề rồi được chuyển tới builder', async ({ page }) => {
    await loginAsAdmin(page);
    const testId = await createDraftTest(page, 'Đề tạo qua biểu mẫu');
    expect(testId).toBeGreaterThan(0);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Trình xây dựng đề thi',
      }),
    ).toBeVisible();
    await expect(page.getByText('Bản nháp')).toBeVisible();

    const row = queryDisposableDb(
      `SELECT "status"::text, "title" FROM "Test" WHERE id = ${String(testId)}`,
    ).trim();
    expect(row).toBe(`draft|${testTitle('Đề tạo qua biểu mẫu')}`);
  });

  test('T3: thêm phần, thêm câu, đổi thứ tự, lưu và reload giữ thứ tự', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const testId = await createDraftTest(page, 'Đề cấu trúc T3');
    await openBuilder(page, testId);

    // Thêm phần qua dialog.
    await page.getByRole('button', { name: 'Thêm phần' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Kỹ năng').selectOption('reading');
    await dialog.getByLabel('Tên phần').fill('Phần thêm câu T3');
    await dialog.getByRole('button', { name: 'Thêm phần' }).click();
    await expect(
      page.getByRole('button', { name: 'Phần 1: Phần thêm câu T3' }),
    ).toBeVisible();

    // Thêm từng câu vào Phần 1 › Nhóm 1 (bảng chỉ hiện trang hiện tại nên lọc
    // theo nội dung để câu mục tiêu nằm ở trang 1).
    await pickBankQuestion(
      page,
      publishedReadingId,
      `${prefix} Câu đọc hiểu đã xuất bản`,
    );
    await page.getByLabel('Thêm vào').selectOption({ index: 0 });
    await page.getByRole('button', { name: 'Thêm 1 câu vào' }).click();
    await expect(
      page.locator('.tst-question__id').filter({
        hasText: new RegExp(`^Q${String(publishedReadingId)}$`, 'u'),
      }),
    ).toHaveCount(1);
    // U5: dòng câu có đoạn trích nội dung + title từ dữ liệu bảng câu.
    const firstExcerpt = page.locator('.tst-question__content').first();
    await expect(firstExcerpt).toHaveAttribute(
      'title',
      `${prefix} Câu đọc hiểu đã xuất bản`,
    );
    await expect(firstExcerpt).not.toBeEmpty();
    // Ngân hàng chỉ hiện câu đã xuất bản: câu nháp seed không có checkbox.
    await expect(
      page.getByLabel(`Chọn câu Q${String(draftQuestionId)}`, { exact: true }),
    ).toHaveCount(0);
    await pickBankQuestion(
      page,
      publishedListeningId,
      `${prefix} Câu nghe hiểu đã xuất bản`,
    );
    await page.getByLabel('Thêm vào').selectOption({ index: 0 });
    await page.getByRole('button', { name: 'Thêm 1 câu vào' }).click();
    await expect(
      page.locator('.tst-question__id').filter({
        hasText: new RegExp(`^Q${String(publishedListeningId)}$`, 'u'),
      }),
    ).toHaveCount(1);

    // Đổi thứ tự: đưa câu thứ hai lên trước.
    await page
      .getByRole('button', {
        name: `Đưa câu Q${String(publishedListeningId)} lên`,
      })
      .click();
    await page.getByRole('button', { name: 'Lưu cấu trúc' }).click();
    await expect(page.getByText('Đã lưu cấu trúc đề thi.')).toBeVisible();

    await page.reload();
    await expect(page.locator('.tst-panel')).toBeVisible();
    // U4: sau reload mọi phần đóng — mở phần 1 để đọc thứ tự câu đã lưu.
    await page.locator('.tst-section__toggle').first().click();
    await expect(page.locator('.tst-section__body').first()).toBeVisible();
    const questionOrder = await page
      .locator('.tst-question__id')
      .allTextContents();
    expect(questionOrder).toEqual([
      `Q${String(publishedListeningId)}`,
      `Q${String(publishedReadingId)}`,
    ]);
    const storedOrder = queryDisposableDb(`
      SELECT "questionId" FROM "TestQuestion"
      WHERE "testId" = ${String(testId)} ORDER BY "orderIndex"
    `)
      .trim()
      .split('\n')
      .map((value) => Number(value));
    expect(storedOrder).toEqual([publishedListeningId, publishedReadingId]);
  });

  test('T4: publish bị chặn hiện lý do tiếng Việt, sửa rồi publish thành công', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    // C9: bắt console/pageerror ngay sau đăng nhập, trước mọi điều hướng.
    const issues = collectIssues(page);
    const testId = await createDraftTest(page, 'Đề publish T4', {
      passScore: '',
    });
    seedEmptyStructure(testId);
    await page.reload();
    await expect(page.locator('.tst-panel')).toBeVisible();

    await page.getByRole('button', { name: 'Xuất bản đề thi' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Xuất bản đề thi' }).click();
    await expect(
      dialog.getByText('Nhóm chưa có câu — Phần 1 › Nhóm 1'),
    ).toBeVisible();
    await expect(dialog.getByText('Chưa nhập điểm đỗ')).toBeVisible();

    // Chỉ console 409 của route publish được phép xuất hiện (T8).
    await expect
      .poll(() =>
        unexpectedIssues(
          issues,
          (issue) =>
            issue.kind === 'console' &&
            issue.text.includes('409') &&
            /\/api\/admin\/tests\/\d+\/publish/u.test(issue.url),
        ),
      )
      .toEqual([]);
    await dialog.getByRole('button', { name: 'Đóng' }).click();

    // Sửa: nhập điểm đỗ, thêm một câu đã xuất bản, lưu cấu trúc.
    await page.getByRole('button', { name: 'Sửa thông tin đề' }).click();
    const metaDialog = page.getByRole('dialog');
    await expect(metaDialog).toBeVisible();
    await metaDialog.getByLabel('Điểm đỗ').fill('60');
    await metaDialog.getByRole('button', { name: 'Lưu thông tin' }).click();
    await expect(page.getByText('Đã cập nhật thông tin đề.')).toBeVisible();

    await pickBankQuestion(
      page,
      publishedReadingId,
      `${prefix} Câu đọc hiểu đã xuất bản`,
    );
    await page.getByRole('button', { name: 'Thêm 1 câu vào' }).click();
    await page.getByRole('button', { name: 'Lưu cấu trúc' }).click();
    await expect(page.getByText('Đã lưu cấu trúc đề thi.')).toBeVisible();

    await page.getByRole('button', { name: 'Xuất bản đề thi' }).click();
    const publishDialog = page.getByRole('dialog');
    await expect(publishDialog).toBeVisible();
    await publishDialog
      .getByRole('button', { name: 'Xuất bản đề thi' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Nhân bản thành nháp' }),
    ).toBeVisible();
    expect(
      queryDisposableDb(
        `SELECT "status"::text FROM "Test" WHERE id = ${String(testId)}`,
      ).trim(),
    ).toBe('published');
  });

  test('T5: nhân bản thành nháp và lưu trữ thì đề rời danh sách mặc định', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const testId = await createDraftTest(page, 'Đề lưu trữ T5', {
      passScore: '60',
    });
    seedStructureWithQuestion(testId, publishedReadingId);
    await page.reload();
    await expect(page.locator('.tst-panel')).toBeVisible();

    // Xuất bản đề để có trạng thái chỉ đọc.
    await page.getByRole('button', { name: 'Xuất bản đề thi' }).click();
    const publishDialog = page.getByRole('dialog');
    await publishDialog
      .getByRole('button', { name: 'Xuất bản đề thi' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Nhân bản thành nháp' }),
    ).toBeVisible();

    // Nhân bản thành đề nháp mới.
    await page.getByRole('button', { name: 'Nhân bản thành nháp' }).click();
    await page.waitForURL(
      (url) => url.pathname !== `/admin/tests/${String(testId)}`,
    );
    const copyId = Number(/\/admin\/tests\/(\d+)$/u.exec(page.url())?.[1]);
    expect(copyId).toBeGreaterThan(0);
    expect(copyId).not.toBe(testId);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Trình xây dựng đề thi',
      }),
    ).toBeVisible();
    expect(
      queryDisposableDb(
        `SELECT "status"::text FROM "Test" WHERE id = ${String(copyId)}`,
      ).trim(),
    ).toBe('draft');

    // Lưu trữ đề đã xuất bản.
    await page.goto(`/admin/tests/${String(testId)}`);
    await page.getByRole('button', { name: 'Lưu trữ' }).click();
    // C7: tên accessible của dialog lấy từ id tiêu đề riêng của dialog đó.
    const archiveDialog = page.getByRole('dialog', { name: 'Lưu trữ đề thi' });
    await expect(archiveDialog).toBeVisible();
    await archiveDialog.getByRole('button', { name: 'Lưu trữ' }).click();
    await expect(page.getByText('Đã lưu trữ đề thi.')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Nhân bản thành nháp' }),
    ).toBeVisible();

    await openList(page);
    await expect(
      page.locator(`a[href="/admin/tests/${String(testId)}"]:visible`),
    ).toHaveCount(0);
    await page.getByLabel('Trạng thái').selectOption('archived');
    await page.getByRole('button', { name: 'Lọc' }).click();
    await page.waitForURL(/status=archived/u);
    await expect(
      page.locator(`a[href="/admin/tests/${String(testId)}"]:visible`).first(),
    ).toBeVisible();
  });

  test('T6: axe 0 vi phạm và dialog focus/Esc/trả focus', async ({ page }) => {
    await loginAsAdmin(page);
    const testId = await createDraftTest(page, 'Đề axe T6');
    await openBuilder(page, testId);
    await addSection(page, 'Phần axe T6');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await openList(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await openBuilder(page, testId);
    const opener = page.getByRole('button', { name: 'Thêm phần' }).first();
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Tên phần')).toBeFocused();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('T7: responsive 390/768/1024/1440 và cột ngắn không bị cắt', async ({
    page,
  }, testInfo) => {
    await loginAsAdmin(page);
    const testId = await createDraftTest(page, 'Đề responsive T7');
    await openBuilder(page, testId);
    await addSection(page, 'Phần responsive T7');

    // Vùng chạm kiểm ngay trên builder còn phần vừa thêm (chưa lưu).
    const controlBoxes: Array<{ width: number; height: number }> = [];
    if (
      testInfo.project.name === 'mobile-390' ||
      testInfo.project.name === 'tablet-768'
    ) {
      const controls = page.locator('.tst-section__head .adm-icon-btn');
      const count = await controls.count();
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index += 1) {
        const box = await controls.nth(index).boundingBox();
        expect(box).not.toBeNull();
        if (box) controlBoxes.push({ width: box.width, height: box.height });
      }
    }

    await openList(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    if (testInfo.project.name === 'desktop-1440') {
      const columns = page.locator('.tst-list-table thead th');
      expect(await columns.count()).toBe(9);
      const shortCells = page.locator(
        '.tst-list-table tbody tr:first-child td:nth-child(1), ' +
          '.tst-list-table tbody tr:first-child td:nth-child(3), ' +
          '.tst-list-table tbody tr:first-child td:nth-child(5), ' +
          '.tst-list-table tbody tr:first-child td:nth-child(6), ' +
          '.tst-list-table tbody tr:first-child td:nth-child(7), ' +
          '.tst-list-table tbody tr:first-child td:nth-child(8), ' +
          '.tst-list-table tbody tr:first-child td:nth-child(9)',
      );
      const cells = await shortCells.count();
      expect(cells).toBe(7);
      for (let index = 0; index < cells; index += 1) {
        const cell = shortCells.nth(index);
        const clipped = await cell.evaluate(
          (element) => element.scrollWidth > element.clientWidth + 1,
        );
        expect(clipped).toBe(false);
      }
    }

    await openBuilder(page, testId);
    if (testInfo.project.name !== 'desktop-1440') {
      // C10: mở một phần rồi kiểm tràn ngang của builder.
      const toggle = page.locator('.tst-section__toggle').first();
      if ((await toggle.count()) > 0) {
        await toggle.click();
        const openOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(openOverflow).toBeLessThanOrEqual(1);
      }
      // C10: mở dialog rồi kiểm tràn ngang.
      await page.getByRole('button', { name: 'Thêm phần' }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      const dialogOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(dialogOverflow).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      const panel = page.locator('.tst-panel');
      const bank = page.locator('.tst-bank');
      const panelBox = await panel.boundingBox();
      const bankBox = await bank.boundingBox();
      expect(panelBox).not.toBeNull();
      expect(bankBox).not.toBeNull();
      if (panelBox && bankBox) {
        expect(panelBox.y).toBeLessThan(bankBox.y);
      }
    }

    for (const box of controlBoxes) {
      expect(box.width).toBeGreaterThanOrEqual(43);
      expect(box.height).toBeGreaterThanOrEqual(43);
    }
  });

  test('T9: panel mặc định đóng, phần mới tự mở, giữ trạng thái sau khi lưu (U4/U6/C3)', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const testId = await createDraftTest(page, 'Đề panel T9');
    seedStructurePreservingDraft(
      testId,
      publishedReadingId,
      publishedListeningId,
    );
    await page.reload();
    await expect(page.locator('.tst-panel')).toBeVisible();

    // U4: mặc định mọi phần đóng — không có thân phần nào hiện.
    await expect(page.locator('.tst-section__body')).toHaveCount(0);
    const toggles = page.locator('.tst-section__toggle');
    await expect(toggles).toHaveCount(2);
    await expect(toggles.nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(toggles.nth(1)).toHaveAttribute('aria-expanded', 'false');

    // U4: mở phần 1, sửa tên nhóm để có thay đổi chưa lưu.
    await toggles.nth(0).click();
    await expect(page.locator('.tst-section__body')).toHaveCount(1);
    const groupTitle = page.getByLabel('Tên nhóm 1 của phần 1');
    await groupTitle.fill('Nhóm đổi tên T9');

    // U6: mỗi phần chỉ có đúng một nút "Thêm nhóm".
    const sectionOne = page.locator('.tst-section').nth(0);
    await expect(
      sectionOne.getByRole('button', { name: 'Thêm nhóm' }),
    ).toHaveCount(1);

    await page.getByRole('button', { name: 'Lưu cấu trúc' }).click();
    await expect(page.getByText('Đã lưu cấu trúc đề thi.')).toBeVisible();

    // U4: giữ trạng thái mở/đóng theo index sau khi lưu.
    await expect(toggles.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(toggles.nth(1)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.tst-section__body')).toHaveCount(1);

    // C3: sau khi lưu, focus nằm trong panel (không rơi về body).
    const activeTag = await page.evaluate(
      () => document.activeElement?.tagName ?? '',
    );
    expect(activeTag.toLowerCase()).not.toBe('body');
  });

  test('T10: lưu cấu trúc lỗi hiện đúng vị trí câu lưu trữ (C1)', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const questionId = seedQuestion({
      content: `${prefix} Câu C1 bị lưu trữ`,
      skill: 'reading',
      status: 'published',
    });
    const testId = await createDraftTest(page, 'Đề lỗi lưu C1');
    seedStructureWithQuestion(testId, questionId);
    // Archive bằng SQL đúng câu đang nằm trong đề nháp.
    queryDisposableDb(`
      UPDATE "Question"
      SET "status" = 'archived'::"ContentStatus",
          "deletedAt" = (now() AT TIME ZONE 'UTC'),
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE id = ${String(questionId)}
    `);
    await page.reload();
    await expect(page.locator('.tst-panel')).toBeVisible();

    // Tạo thay đổi cấu trúc để nút "Lưu cấu trúc" bật, rồi lưu.
    await page.locator('.tst-section__toggle').first().click();
    await page.getByLabel('Tên nhóm 1 của phần 1').fill('Nhóm C1 đổi tên');
    await page.getByRole('button', { name: 'Lưu cấu trúc' }).click();
    await expect(
      page.getByText(
        'Không lưu được: câu đã bị lưu trữ — Phần 1 › Nhóm 1 › Câu 1',
      ),
    ).toBeVisible();
  });

  test('T8: console chỉ có đúng lỗi 409 đã khai báo', async ({ page }) => {
    await loginAsAdmin(page);
    // C9: bắt console/pageerror ngay sau đăng nhập, trước mọi điều hướng.
    const issues = collectIssues(page);
    await createDraftTest(page, 'Đề console T8', { passScore: '' });
    await page.getByRole('button', { name: 'Xuất bản đề thi' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Xuất bản đề thi' }).click();
    await expect(dialog.getByText('Đề chưa có phần nào')).toBeVisible();
    await expect
      .poll(() =>
        unexpectedIssues(
          issues,
          (issue) =>
            issue.kind === 'console' &&
            issue.text.includes('409') &&
            /\/api\/admin\/tests\/\d+\/publish/u.test(issue.url),
        ),
      )
      .toEqual([]);
    const declared = issues.filter(
      (issue) =>
        issue.kind === 'console' &&
        issue.text.includes('409') &&
        /\/api\/admin\/tests\/\d+\/publish/u.test(issue.url),
    );
    expect(declared.length).toBe(1);
  });
});
