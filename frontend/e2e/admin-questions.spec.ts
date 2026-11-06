import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { queryDisposableDb, sqlLiteral } from './support/disposable-db';

/**
 * M4.1a — Ngân hàng câu hỏi (TL-88…TL-92).
 *
 * Dữ liệu seed bằng SQL theo TL-92 (khuôn `admin-users.spec.ts`): mỗi project
 * một tiền tố riêng nên bốn project chạy tuần tự trên cùng database disposable
 * không đụng nhau. Không dùng `.skip`; test chỉ dành cho desktop/mobile
 * `return` sớm theo `testInfo.project.name`.
 */

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin.frontend@example.test';
const adminPassword =
  process.env.E2E_ADMIN_PASSWORD ?? 'FrontendTest-Admin-123';

let prefix = 'm41a';
let tagName = '';
let ids: {
  listening: number;
  reading: number;
  writing: number;
  archived: number;
  pending: number;
};
let createdMcqId = 0;
let createdTrueFalseId = 0;
let createdFillBlankId = 0;
let createdArrangeId = 0;

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

function expectedBankCounts(): {
  total: number;
  listening: number;
  reading: number;
  writing: number;
  speaking: number;
  vocabularyGrammar: number;
} {
  const live = `"status" <> 'archived' AND "deletedAt" IS NULL`;
  const read = (sql: string) => Number(queryDisposableDb(sql));
  return {
    total: read(`SELECT count(*)::int FROM "Question" WHERE ${live}`),
    listening: read(
      `SELECT count(*)::int FROM "Question" WHERE ${live} AND "skill" = 'listening'::"Skill"`,
    ),
    reading: read(
      `SELECT count(*)::int FROM "Question" WHERE ${live} AND "skill" = 'reading'::"Skill"`,
    ),
    writing: read(
      `SELECT count(*)::int FROM "Question" WHERE ${live} AND "skill" = 'writing'::"Skill"`,
    ),
    speaking: read(
      `SELECT count(*)::int FROM "Question" WHERE ${live} AND "skill" = 'speaking'::"Skill"`,
    ),
    vocabularyGrammar: read(`
      SELECT count(*)::int FROM "Question" q
      WHERE q."status" <> 'archived' AND q."deletedAt" IS NULL
        AND EXISTS (
          SELECT 1 FROM "QuestionTag" qt JOIN "Tag" t ON t."id" = qt."tagId"
          WHERE qt."questionId" = q."id" AND t."slug" IN ('tu-vung', 'ngu-phap')
        )
    `),
  };
}

function levelId(code: string): number {
  return queryNumber(`SELECT id FROM "Level" WHERE code = ${sqlLiteral(code)}`);
}

type SeedQuestionInput = {
  content: string;
  type: 'mcq' | 'true_false' | 'fill_blank' | 'arrange_sentence';
  skill: 'listening' | 'reading' | 'writing' | 'speaking';
  levelCode: string;
  difficulty: number | null;
  status: 'draft' | 'published' | 'archived';
  tags: string[];
  explanation: string | null;
};

const ANSWERS: Record<SeedQuestionInput['type'], string> = {
  mcq: JSON.stringify({
    options: [
      { id: 'seed-a', text: 'Xin chào' },
      { id: 'seed-b', text: 'Tạm biệt' },
    ],
  }),
  true_false: '{}',
  fill_blank: '{}',
  arrange_sentence: JSON.stringify({
    tokens: [
      { id: 'seed-t1', text: '我' },
      { id: 'seed-t2', text: '是' },
    ],
  }),
};

const CORRECT: Record<SeedQuestionInput['type'], string> = {
  mcq: JSON.stringify({ optionId: 'seed-a' }),
  true_false: JSON.stringify({ value: true }),
  fill_blank: JSON.stringify({ acceptedTexts: ['học'] }),
  arrange_sentence: JSON.stringify({ tokenIds: ['seed-t1', 'seed-t2'] }),
};

function seedQuestion(input: SeedQuestionInput): number {
  const existing = findId(
    `SELECT id FROM "Question" WHERE content = ${sqlLiteral(input.content)} ORDER BY id LIMIT 1`,
  );
  if (existing !== null) return existing;
  const authorId = adminId();
  const publishedAt =
    input.status === 'published' ? 'CURRENT_TIMESTAMP' : 'NULL';
  const deletedAt = input.status === 'archived' ? 'CURRENT_TIMESTAMP' : 'NULL';
  const id = queryNumber(`
    WITH ins AS (
    INSERT INTO "Question" (
      "content", "type", "skill", "answers", "correctAnswer", "explanation",
      "levelId", "difficulty", "version", "contentHash", "status",
      "publishedAt", "publishedById", "createdById", "updatedById",
      "deletedAt", "createdAt", "updatedAt"
    ) VALUES (
      ${sqlLiteral(input.content)},
      ${sqlLiteral(input.type)}::"QuestionType",
      ${sqlLiteral(input.skill)}::"Skill",
      ${sqlLiteral(ANSWERS[input.type])}::jsonb,
      ${sqlLiteral(CORRECT[input.type])}::jsonb,
      ${input.explanation === null ? 'NULL' : sqlLiteral(input.explanation)},
      ${levelId(input.levelCode)},
      ${input.difficulty === null ? 'NULL' : String(input.difficulty)},
      1,
      ${sqlLiteral('a'.repeat(64))},
      ${sqlLiteral(input.status)}::"ContentStatus",
      ${publishedAt},
      ${input.status === 'published' ? String(authorId) : 'NULL'},
      ${authorId},
      ${authorId},
      ${deletedAt},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    RETURNING "id"
    ) SELECT "id" FROM ins
  `);
  for (const name of input.tags) {
    const slug = name
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/gu, '');
    const tagId = queryNumber(`
      WITH ins AS (
        INSERT INTO "Tag" ("name", "slug", "createdAt", "updatedAt")
        VALUES (${sqlLiteral(name)}, ${sqlLiteral(slug)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = CURRENT_TIMESTAMP
        RETURNING "id"
      ) SELECT "id" FROM ins
    `);
    queryDisposableDb(`
      INSERT INTO "QuestionTag" ("questionId", "tagId", "createdAt")
      VALUES (${id}, ${tagId}, CURRENT_TIMESTAMP)
      ON CONFLICT ("questionId", "tagId") DO NOTHING
    `);
  }
  return id;
}

function snapshot(input: {
  content: string;
  type: SeedQuestionInput['type'];
  skill: SeedQuestionInput['skill'];
  levelCode: string;
  explanation: string | null;
  tags: string[];
}): string {
  return JSON.stringify({
    type: input.type,
    skill: input.skill,
    levelId: levelId(input.levelCode),
    content: input.content,
    answers: JSON.parse(ANSWERS[input.type]),
    correctAnswer: JSON.parse(CORRECT[input.type]),
    explanation: input.explanation,
    objective: null,
    difficulty: null,
    audioId: null,
    imageId: null,
    tags: input.tags,
  });
}

function seedRevision(input: {
  questionId: number;
  revision: number;
  snapshot: string;
  hash: string;
  decision: 'approved' | 'changes_requested' | null;
  note: string | null;
}): number {
  const existing = findId(`
    SELECT id FROM "ContentRevision"
    WHERE "entityType" = 'question'::"ContentEntityType"
      AND "entityId" = ${input.questionId} AND "revision" = ${input.revision}
    ORDER BY id LIMIT 1
  `);
  if (existing !== null) {
    const hasReview = findId(
      `SELECT id FROM "ContentReview" WHERE "revisionId" = ${existing} ORDER BY id LIMIT 1`,
    );
    if (input.decision !== null && hasReview === null) {
      const reviewerId = adminId();
      queryDisposableDb(`
        INSERT INTO "ContentReview" ("revisionId", "reviewerId", "decision", "note", "createdAt")
        VALUES (
          ${existing}, ${reviewerId},
          ${sqlLiteral(input.decision)}::"ContentReviewDecision",
          ${input.note === null ? 'NULL' : sqlLiteral(input.note)},
          CURRENT_TIMESTAMP
        )
      `);
    }
    return existing;
  }
  const authorId = adminId();
  const revisionId = queryNumber(`
    WITH ins AS (
      INSERT INTO "ContentRevision" (
        "entityType", "entityId", "revision", "snapshot", "contentHash",
        "authorId", "createdAt"
      ) VALUES (
        'question'::"ContentEntityType", ${input.questionId}, ${input.revision},
        ${sqlLiteral(input.snapshot)}::jsonb, ${sqlLiteral(input.hash)},
        ${authorId}, CURRENT_TIMESTAMP
      )
      RETURNING "id"
    ) SELECT "id" FROM ins
  `);
  if (input.decision !== null) {
    queryDisposableDb(`
      INSERT INTO "ContentReview" ("revisionId", "reviewerId", "decision", "note", "createdAt")
      VALUES (
        ${revisionId}, ${authorId},
        ${sqlLiteral(input.decision)}::"ContentReviewDecision",
        ${input.note === null ? 'NULL' : sqlLiteral(input.note)},
        CURRENT_TIMESTAMP
      )
    `);
  }
  return revisionId;
}

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Mật khẩu').fill(adminPassword);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL(/\/(admin\/|forbidden)/u);
}

async function openQuestions(page: Page) {
  await page.goto('/admin/questions');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ngân hàng câu hỏi' }),
  ).toBeVisible();
}

function bankItem(page: Page, label: RegExp) {
  return page
    .getByRole('navigation', { name: 'Ngân hàng câu hỏi' })
    .getByRole('link', { name: label });
}

async function bankCount(page: Page, label: RegExp): Promise<number> {
  const item = bankItem(page, label);
  await item.click();
  await expect(item).toHaveAttribute('aria-current', 'true');
  const text = await item.locator('.qn-bank__count').innerText();
  return Number(text);
}

/** Có link chọn/khối lịch sử trỏ tới câu này trong DOM (bảng desktop hoặc card). */
async function selectedQuestionLinkCount(
  page: Page,
  id: number,
): Promise<number> {
  return page.locator(`a[href*="selected=${id}"]`).count();
}

/** Link chọn câu đang hiển thị (bảng desktop hoặc card mobile). */
function visibleSelectedLink(page: Page, id: number) {
  return page.locator(`a[href*="selected=${id}"]:visible`).first();
}

/** Cho phép đúng các console error khai báo tường minh (F5). */
type PageIssue = { kind: 'console' | 'pageerror'; text: string; url: string };
type AllowedIssue = (issue: PageIssue) => boolean;

test.describe('Ngân hàng câu hỏi (M4.1a)', () => {
  test.beforeAll(({}, testInfo) => {
    prefix = `m41a-${testInfo.project.name.replace(/[^a-z0-9]+/giu, '-')}`;
    tagName = `M41a Từ vựng ${testInfo.project.name}`;
    // Playwright khởi động lại worker sau test lỗi và chạy lại beforeAll.
    // ContentRevision là append-only (trigger immutable), nên seed idempotent
    // theo từng bản ghi: đã có thì đọc id, chưa có mới INSERT.
    const listening = seedQuestion({
      content: `${prefix} Câu nghe chọn đáp án`,
      type: 'mcq',
      skill: 'listening',
      levelCode: 'HSK1',
      difficulty: 1,
      status: 'published',
      tags: [],
      explanation: 'Đáp án đúng là lời chào.',
    });
    const reading = seedQuestion({
      content: `${prefix} Câu đọc hiểu bản nháp`,
      type: 'mcq',
      skill: 'reading',
      levelCode: 'HSK2',
      difficulty: 2,
      status: 'draft',
      tags: ['tu-vung', tagName],
      explanation: null,
    });
    const writing = seedQuestion({
      content: `${prefix} Câu viết điền từ`,
      type: 'fill_blank',
      skill: 'writing',
      levelCode: 'HSK1',
      difficulty: 3,
      status: 'published',
      tags: ['ngu-phap', tagName],
      explanation: 'Điền động từ đúng.',
    });
    const archived = seedQuestion({
      content: `${prefix} Câu đã lưu trữ`,
      type: 'true_false',
      skill: 'reading',
      levelCode: 'HSK1',
      difficulty: null,
      status: 'archived',
      tags: [tagName],
      explanation: null,
    });
    const pending = seedQuestion({
      content: `${prefix} Câu có bản sửa chờ`,
      type: 'mcq',
      skill: 'reading',
      levelCode: 'HSK2',
      difficulty: 2,
      status: 'published',
      tags: [],
      explanation: 'Bản đang live.',
    });
    seedRevision({
      questionId: pending,
      revision: 1,
      snapshot: snapshot({
        content: `${prefix} Câu có bản sửa chờ`,
        type: 'mcq',
        skill: 'reading',
        levelCode: 'HSK2',
        explanation: 'Bản đang live.',
        tags: [],
      }),
      hash: 'b'.repeat(64),
      decision: 'approved',
      note: null,
    });
    seedRevision({
      questionId: pending,
      revision: 2,
      snapshot: snapshot({
        content: `${prefix} Câu có bản sửa chờ`,
        type: 'mcq',
        skill: 'reading',
        levelCode: 'HSK2',
        explanation: 'Bản sửa chờ duyệt.',
        tags: [],
      }),
      hash: 'c'.repeat(64),
      decision: 'changes_requested',
      note: 'Cần bổ sung giải thích',
    });
    ids = { listening, reading, writing, archived, pending };
  });

  let issues: PageIssue[] = [];
  let allowedIssues: AllowedIssue[] = [];

  test.beforeEach(async ({ page }) => {
    issues = [];
    allowedIssues = [];
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
      issues.push({ kind: 'pageerror', text: error.message, url: '' });
    });
  });

  test.afterEach(() => {
    // F5: chỉ các mục khai báo tường minh (tối đa đúng số lần) được phép;
    // mọi console error/pageerror khác vẫn phải bằng 0.
    const unexpected = issues.filter((issue) => {
      const index = allowedIssues.findIndex((matcher) => matcher(issue));
      if (index === -1) return true;
      allowedIssues.splice(index, 1);
      return false;
    });
    expect(
      unexpected,
      `unexpected console/pageerror:\n${JSON.stringify(unexpected, null, 2)}`,
    ).toEqual([]);
    expect(
      allowedIssues.length,
      'declared console error did not occur (or occurred fewer times than declared)',
    ).toBe(0);
  });

  /** F5: console 409 chủ đích của route publish, đúng 1 lần. */
  function allowPublishConflict(questionId: number): void {
    allowedIssues.push(
      (issue) =>
        issue.kind === 'console' &&
        issue.text.includes('status of 409') &&
        new RegExp(
          `/api/admin/questions/${questionId}/revisions/\\d+/publish$`,
          'u',
        ).test(issue.url),
    );
  }

  test('Q1: danh sách, 8 cột, bộ lọc URL và số đếm cột Ngân hàng', async ({
    page,
  }, testInfo) => {
    await loginAsAdmin(page);
    await openQuestions(page);

    // F8: skip link "Đến nội dung chính" không được hiện/nhận focus khi vừa
    // load; chỉ trượt vào khi được focus (bàn phím).
    const skip = page.getByRole('link', { name: 'Đến nội dung chính' });
    const skipState = await skip.evaluate((element) => ({
      focused: element === document.activeElement,
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
    }));
    expect(skipState.focused).toBe(false);
    expect(skipState.bottom).toBeLessThanOrEqual(0);
    await skip.focus();
    await expect(skip).toBeFocused();
    const skipOnFocus = await skip.evaluate(
      (element) => element.getBoundingClientRect().top,
    );
    expect(skipOnFocus).toBeGreaterThanOrEqual(0);
    await skip.blur();

    // TL-82a/82b: số đếm cột trái = meta.total của bảng cho cả "Tất cả",
    // từng kỹ năng và nhóm "Từ vựng & Ngữ pháp" (2 tag OR).
    const expected = expectedBankCounts();
    const countAndTotal = async (label: RegExp) => {
      const count = await bankCount(page, label);
      const info = await page.locator('.adm-pagination__info').innerText();
      return { count, info };
    };
    const all = await countAndTotal(/Tất cả câu hỏi/);
    expect(all.count).toBe(expected.total);
    expect(all.info).toContain(`của ${all.count} kết quả`);
    await expect(page).toHaveURL(/\/admin\/questions\?page=1&limit=20$/u);

    for (const [label, expectedCount] of [
      [/Nghe hiểu/, expected.listening],
      [/Đọc hiểu/, expected.reading],
      [/Viết/, expected.writing],
      [/Nói/, expected.speaking],
    ] as const) {
      const result = await countAndTotal(label);
      expect(result.count).toBe(expectedCount);
      expect(result.info).toContain(`của ${result.count} kết quả`);
    }

    const vocab = await countAndTotal(/Từ vựng & Ngữ pháp/);
    expect(vocab.count).toBe(expected.vocabularyGrammar);
    expect(vocab.info).toContain(`của ${vocab.count} kết quả`);
    await expect(page).toHaveURL(/tag=tu-vung/u);
    await expect(page).toHaveURL(/tag=ngu-phap/u);
    await expect(page.getByLabel('Chủ đề')).toHaveValue('');
    expect(await selectedQuestionLinkCount(page, ids.reading)).toBeGreaterThan(
      0,
    );
    expect(await selectedQuestionLinkCount(page, ids.writing)).toBeGreaterThan(
      0,
    );
    const archivedLinks = await page
      .locator(`a[href$="selected=${ids.archived}"]`)
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(archivedLinks, `archivedId=${ids.archived}`).toEqual([]);

    // Tìm theo nội dung: chỉ còn câu seed của project này; câu archived bị
    // loại khỏi danh sách mặc định (TL-82a/F2).
    await page.getByLabel('Tìm kiếm nội dung câu hỏi').fill(prefix);
    await page.getByRole('button', { name: 'Lọc', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`q=${prefix}`, 'u'));
    expect(
      await selectedQuestionLinkCount(page, ids.listening),
    ).toBeGreaterThan(0);
    expect(await selectedQuestionLinkCount(page, ids.archived)).toBe(0);

    // Nhãn phụ "Có bản sửa chờ duyệt" (TL-89) chỉ ở câu published có bản sửa
    // mới hơn bản live (bảng desktop và card cùng render, chỉ một cái hiện).
    const pendingRow = page
      .locator('.qn-table tbody tr')
      .filter({ hasText: `${prefix} Câu có bản sửa chờ` });
    await expect(pendingRow.locator('.qn-pending')).toHaveText(
      'Có bản sửa chờ duyệt',
    );
    const pendingCard = page
      .locator('.qn-record-list > li')
      .filter({ hasText: `${prefix} Câu có bản sửa chờ` });
    await expect(pendingCard.locator('.qn-pending')).toHaveText(
      'Có bản sửa chờ duyệt',
    );

    if (testInfo.project.name === 'desktop-1440') {
      const row = page
        .locator('.qn-table tbody tr')
        .filter({ hasText: `${prefix} Câu nghe chọn đáp án` });
      await expect(row.getByRole('cell')).toHaveCount(8);
      await expect(row).toContainText(`Q${ids.listening}`);
      await expect(row).toContainText('Nghe hiểu');
      await expect(row).toContainText('HSK 1');
      await expect(row).toContainText('Dễ');
      await expect(row).toContainText('v1');
      await expect(row).toContainText(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/u);
      await expect(row).toContainText('Đã xuất bản');
      // G1: cột 1 và 3–8 hiện đủ chữ ở cả tiêu đề lẫn giá trị (không bị cắt);
      // chỉ cột 2 co/cắt và vẫn đủ chỗ cho ~40 ký tự ở 1440.
      const clipped = await page.evaluate(() => {
        const indexes = [0, 2, 3, 4, 5, 6, 7];
        const collect = (elements: Element[]) =>
          indexes.map((index) => ({
            index,
            scrollWidth: elements[index]?.scrollWidth ?? -1,
            clientWidth: elements[index]?.clientWidth ?? -1,
          }));
        const headers = Array.from(
          document.querySelectorAll('.qn-table thead th'),
        );
        const firstRow = document.querySelector('.qn-table tbody tr');
        const cells = firstRow
          ? Array.from(firstRow.querySelectorAll('td'))
          : [];
        return { headers: collect(headers), cells: collect(cells) };
      });
      for (const cell of [...clipped.headers, ...clipped.cells]) {
        expect(
          cell.scrollWidth,
          `cột ${cell.index + 1} bị cắt: scrollWidth=${cell.scrollWidth} clientWidth=${cell.clientWidth}`,
        ).toBeLessThanOrEqual(cell.clientWidth);
      }
      const capacity = await page.evaluate(() => {
        const link = document.querySelector('.qn-cell-content');
        const cell = link?.closest('td') ?? null;
        if (!link || !cell) return { okay: false, inner: 0, forty: 0 };
        const style = getComputedStyle(link);
        const context = document.createElement('canvas').getContext('2d');
        if (!context) return { okay: false, inner: 0, forty: 0 };
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const forty = context.measureText('n'.repeat(40)).width;
        const cellStyle = getComputedStyle(cell);
        const inner =
          cell.clientWidth -
          parseFloat(cellStyle.paddingLeft) -
          parseFloat(cellStyle.paddingRight);
        return { okay: inner >= forty, inner, forty };
      });
      expect(capacity.okay, JSON.stringify(capacity)).toBe(true);
      const nowrap = await page
        .locator('.qn-table tbody tr')
        .first()
        .locator('td')
        .evaluateAll((cells) =>
          cells.map((cell) => getComputedStyle(cell).whiteSpace),
        );
      expect(nowrap).toEqual(Array(8).fill('nowrap'));
      // G2: cột ID và tiêu đề card tách nhau (kiểm ở Q6 cho card hẹp).
    }

    // F2: bộ lọc Trạng thái có "Lưu trữ" và status=archived trả câu lưu trữ.
    await page.getByText('Bộ lọc', { exact: true }).click();
    await expect(
      page.getByLabel('Trạng thái').locator('option[value="archived"]'),
    ).toHaveText('Lưu trữ');
    await page.getByLabel('Trạng thái').selectOption('archived');
    await page.getByRole('button', { name: 'Lọc', exact: true }).click();
    await expect(page).toHaveURL(/status=archived/u);
    expect(await selectedQuestionLinkCount(page, ids.archived)).toBeGreaterThan(
      0,
    );

    // Lọc theo HSK + trạng thái nháp (mở lại "Bộ lọc" sau lần submit trước).
    await page.getByLabel('Cấp độ HSK').selectOption({ label: 'HSK 2' });
    await page.getByText('Bộ lọc', { exact: true }).click();
    await page.getByLabel('Trạng thái').selectOption('draft');
    await page.getByRole('button', { name: 'Lọc', exact: true }).click();
    await expect(page).toHaveURL(/levelId=\d+/u);
    await expect(page).toHaveURL(/status=draft/u);
    expect(await selectedQuestionLinkCount(page, ids.reading)).toBeGreaterThan(
      0,
    );
    expect(await selectedQuestionLinkCount(page, ids.listening)).toBe(0);

    // Lọc theo chủ đề lấy từ TL-93: ô chọn hiện tên tag (không phải slug).
    const tagSelect = page.getByLabel('Chủ đề');
    const tagOption = tagSelect
      .locator(`option[value]:not([value=""])`)
      .filter({
        hasText: tagName,
      });
    await expect(tagOption).toHaveCount(1);
    await tagSelect.selectOption({ label: tagName });
    await page.getByRole('button', { name: 'Lọc', exact: true }).click();
    await expect(page).toHaveURL(/tag=/u);
    expect(await selectedQuestionLinkCount(page, ids.reading)).toBeGreaterThan(
      0,
    );
    expect(await selectedQuestionLinkCount(page, ids.listening)).toBe(0);
  });

  test('Q2: tạo đủ 4 dạng câu hỏi và gợi ý tag từ TL-93', async ({
    page,
  }, testInfo) => {
    await loginAsAdmin(page);
    await page.goto('/admin/questions/new');
    // Gợi ý tag (datalist) do server dựng từ GET /admin/cms/tags.
    await expect(page.locator('#qn-tag-suggestions option')).not.toHaveCount(0);
    // G5 (desktop-1440): radio dùng accent jade của house pattern, không phải
    // màu mặc định `auto`, và không bị phóng to quá 24px.
    if (testInfo.project.name === 'desktop-1440') {
      const radioStyle = await page
        .locator('.qn-option__radio input')
        .first()
        .evaluate((element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return {
            accent: style.accentColor,
            width: box.width,
            height: box.height,
          };
        });
      expect(radioStyle.accent).not.toBe('auto');
      expect(radioStyle.width).toBeLessThanOrEqual(24);
      expect(radioStyle.height).toBeLessThanOrEqual(24);
    }

    createdMcqId = await createQuestion(page, {
      type: 'Trắc nghiệm',
      content: `${prefix} UI câu trắc nghiệm`,
      kind: 'mcq',
    });
    createdTrueFalseId = await createQuestion(page, {
      type: 'Đúng/Sai',
      content: `${prefix} UI câu đúng sai`,
      kind: 'true_false',
    });
    createdFillBlankId = await createQuestion(page, {
      type: 'Điền từ',
      content: `${prefix} UI câu điền từ`,
      kind: 'fill_blank',
    });
    createdArrangeId = await createQuestion(page, {
      type: 'Sắp xếp câu',
      content: `${prefix} UI câu sắp xếp`,
      kind: 'arrange',
    });

    for (const id of [
      createdMcqId,
      createdTrueFalseId,
      createdFillBlankId,
      createdArrangeId,
    ]) {
      await page.goto(`/admin/questions/${id}`);
      await expect(
        page.locator('.adm-page-head .adm-badge', { hasText: 'Bản nháp' }),
      ).toBeVisible();
    }
  });

  test('Q3: duyệt, chặn publish khi thiếu giải thích, sửa rồi publish', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/questions/${createdMcqId}`);
    await page.getByRole('radio', { name: 'Duyệt', exact: true }).check();
    await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
    await expect(page.getByText('Đã gửi đánh giá.')).toBeVisible();

    // F5: publish lỗi giờ đi từ backend; khai báo đúng 1 console 409 của
    // route publish, mọi console/pageerror khác vẫn phải bằng 0.
    allowPublishConflict(createdMcqId);
    await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
    // TL-91: publish thiếu giải thích bị chặn và liệt kê đúng lý do tiếng Việt.
    await expect(page.getByText('Thiếu giải thích.')).toBeVisible();
    await expect(
      page.locator('.adm-page-head .adm-badge', { hasText: 'Bản nháp' }),
    ).toBeVisible();

    // Sửa: thêm giải thích → bản sửa mới → duyệt → publish.
    await page
      .locator('#qn-explanation')
      .fill('Giải thích bổ sung cho câu hỏi.');
    await page.getByRole('button', { name: 'Lưu bản sửa' }).click();
    // router.refresh() tải dữ liệu server: chờ bản sửa 2 xuất hiện trước khi
    // duyệt (nếu duyệt bản cũ sẽ nhận 409 REVISION_NOT_LATEST).
    await expect(page.getByText(/Bản sửa 2 ·/u)).toBeVisible();
    await page.getByRole('radio', { name: 'Duyệt', exact: true }).check();
    await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
    await expect(page.getByText('Đã gửi đánh giá.')).toBeVisible();
    await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
    await expect(page.getByText('Đã xuất bản câu hỏi.')).toBeVisible();
    await expect(
      page.locator('.adm-page-head .adm-badge', { hasText: 'Đã xuất bản' }),
    ).toBeVisible();
  });

  test('Q4: chọn hàng bằng link và lịch sử phiên bản đúng thứ tự/nội dung', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await openQuestions(page);
    await page.getByLabel('Tìm kiếm nội dung câu hỏi').fill(prefix);
    await page.getByRole('button', { name: 'Lọc', exact: true }).click();

    // Bấm bằng bàn phím trên link thật trong ô (không onClick ở <tr>).
    const selectLink = visibleSelectedLink(page, ids.pending);
    await selectLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`selected=${ids.pending}`, 'u'));
    await expect(
      page
        .locator('.qn-table tbody tr')
        .filter({ hasText: `${prefix} Câu có bản sửa chờ` }),
    ).toHaveAttribute('aria-current', 'true');

    const history = page.locator('.qn-history');
    await expect(
      history.getByRole('heading', { name: 'Lịch sử phiên bản' }),
    ).toBeVisible();
    const rows = history.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('v2');
    await expect(rows.nth(0)).toContainText('Giải thích');
    await expect(rows.nth(0)).toContainText('Bạn');
    await expect(rows.nth(0)).toContainText('Cần bổ sung giải thích');
    await expect(rows.nth(1)).toContainText('v1');
    await expect(rows.nth(1)).toContainText('Tạo câu hỏi');
    await expect(
      history.getByRole('link', { name: 'Mở câu hỏi' }),
    ).toHaveAttribute('href', `/admin/questions/${ids.pending}`);
  });

  test('Q5: dialog lưu trữ focus/Esc/trả focus và lưu trữ thành công', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/questions/${createdTrueFalseId}`);
    const archiveButton = page.getByRole('button', {
      name: 'Lưu trữ',
      exact: true,
    });
    await archiveButton.click();
    const dialog = page.getByRole('dialog', { name: 'Lưu trữ câu hỏi' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Huỷ', exact: true }),
    ).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(archiveButton).toBeFocused();

    await archiveButton.click();
    await dialog.getByRole('button', { name: 'Xác nhận lưu trữ' }).click();
    await expect(page.getByText('Đã lưu trữ câu hỏi.')).toBeVisible();
    await expect(
      page.locator('.adm-page-head .adm-badge', { hasText: 'Lưu trữ' }),
    ).toBeVisible();
    // Form khoá và khối workflow thay bằng thông báo đã lưu trữ.
    await expect(page.locator('#qn-archived-notice')).toBeVisible();
    await expect(
      page
        .locator('.qn-workflow')
        .getByText('Câu hỏi đã lưu trữ — không thể thay đổi.'),
    ).toBeVisible();
  });

  test('Q8: câu đã published, bản sửa mới thiếu giải thích bị chặn publish', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/questions/${createdMcqId}`);
    // Q3 đã publish bản sửa 2; tạo bản sửa 3 không có giải thích.
    await page.locator('#qn-explanation').fill('');
    await page.getByRole('button', { name: 'Lưu bản sửa' }).click();
    await expect(page.getByText(/Bản sửa 3 ·/u)).toBeVisible();
    await page.getByRole('radio', { name: 'Duyệt', exact: true }).check();
    await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
    await expect(page.getByText('Đã gửi đánh giá.')).toBeVisible();

    // F5: lý do bị chặn lấy từ backend `details.reasons`; đúng một console 409.
    allowPublishConflict(createdMcqId);
    await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
    await expect(page.getByText('Thiếu giải thích.')).toBeVisible();
    await expect(
      page.locator('.adm-page-head .adm-badge', { hasText: 'Đã xuất bản' }),
    ).toBeVisible();
  });

  test('Q7: axe 0 vi phạm, landmark, th scope và vùng live rỗng không chiếm chỗ', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await openQuestions(page);

    // Landmark + th scope (TL-92).
    await expect(page.getByRole('main')).toBeVisible();
    const scopes = await page
      .locator('.qn-table th')
      .evaluateAll((headers) =>
        headers.map((header) => header.getAttribute('scope')),
      );
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes.every((scope) => scope === 'col')).toBe(true);

    const listAxe = await new AxeBuilder({ page }).analyze();
    expect(listAxe.violations.map((violation) => violation.id)).toEqual([]);

    // Khối lịch sử + hàng đang chọn cũng phải axe-clean.
    await page.goto(`/admin/questions?selected=${ids.pending}`);
    await expect(page.locator('.qn-history')).toBeVisible();
    const historyAxe = await new AxeBuilder({ page }).analyze();
    expect(historyAxe.violations.map((violation) => violation.id)).toEqual([]);

    // Trang chi tiết: axe-clean và vùng live rỗng không chiếm chỗ (N2/M5.3).
    await page.goto(`/admin/questions/${ids.pending}`);
    await expect(page.locator('.qn-workflow')).toBeVisible();
    const detailAxe = await new AxeBuilder({ page }).analyze();
    expect(detailAxe.violations.map((violation) => violation.id)).toEqual([]);
    const emptyLive = page.locator('.qn-workflow .qn-live');
    expect(
      await emptyLive.evaluate(
        (element) => element.getBoundingClientRect().height,
      ),
    ).toBe(0);

    // F4: role="alert" giữ trong DOM nhưng rỗng thì không chiếm chỗ, và mọi
    // `.qn-live` rỗng cũng cao 0 (không display:none).
    await page.goto('/admin/questions/new');
    const formError = page.locator('#qn-form-error');
    await expect(formError).toHaveAttribute('role', 'alert');
    expect(
      await formError.evaluate(
        (element) => element.getBoundingClientRect().height,
      ),
    ).toBe(0);
    const formLive = page.locator('.qn-form .qn-live');
    expect(
      await formLive.evaluate(
        (element) => element.getBoundingClientRect().height,
      ),
    ).toBe(0);
    const formAxe = await new AxeBuilder({ page }).analyze();
    expect(formAxe.violations.map((violation) => violation.id)).toEqual([]);
  });

  test('Q6: responsive 900/390 không cuộn ngang và bảng chuyển dạng card', async ({
    page,
  }) => {
    const width = page.viewportSize()?.width ?? 1440;
    if (width > 900) return;
    await loginAsAdmin(page);
    await openQuestions(page);
    await expect(page.locator('.adm-table-wrap--swap')).toBeHidden();
    await expect(page.locator('.qn-record-list')).toBeVisible();

    // F7: card hẹp — ID là nhãn nhỏ riêng, meta 2 cột (1 cột ở ≤430px như
    // card admin-users), link chọn có nhãn "Xem lịch sử" và ≥44px.
    const firstCard = page.locator('.qn-record-list > li').first();
    await expect(firstCard.locator('.qn-record-list__id')).toHaveText(
      /^Q\d+$/u,
    );
    await expect(
      firstCard.locator('.adm-record-list__head strong'),
    ).toBeVisible();
    const cardLink = firstCard.getByRole('link', {
      name: /Xem lịch sử câu hỏi/u,
    });
    await expect(cardLink).toBeVisible();
    expect(
      await cardLink.evaluate(
        (element) => element.getBoundingClientRect().height,
      ),
    ).toBeGreaterThanOrEqual(44);

    // G2: ID (nhãn nhỏ) và tiêu đề không chồng nhau, accessible text có ranh giới.
    const idBox = await firstCard.locator('.qn-record-list__id').boundingBox();
    const titleBox = await firstCard
      .locator('.adm-record-list__head strong')
      .boundingBox();
    expect(idBox, 'idBox').not.toBeNull();
    expect(titleBox, 'titleBox').not.toBeNull();
    expect(
      idBox !== null &&
        titleBox !== null &&
        (idBox.y + idBox.height <= titleBox.y + 1 ||
          idBox.x + idBox.width + 4 <= titleBox.x),
      `id=${JSON.stringify(idBox)} title=${JSON.stringify(titleBox)}`,
    ).toBe(true);
    const headText = await firstCard
      .locator('.adm-record-list__head')
      .evaluate((element) => element.textContent ?? '');
    expect(headText).toMatch(/^Q\d+\s/u);
    const cardColumns = await firstCard
      .locator('.adm-record-list__facts')
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(' ').length,
      );
    expect(cardColumns).toBe(width <= 430 ? 1 : 2);

    const listOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(listOverflow).toBe(true);

    await page.goto('/admin/questions/new');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tạo câu hỏi' }),
    ).toBeVisible();
    const formOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(formOverflow).toBe(true);

    // G3+G5 (≤430px): radio | input co giãn | nút × trên một hàng; radio 1.1rem
    // nằm trong label 44px, tâm radio/input thẳng nhau; input ≥180px, nút ×
    // cao ≥44px. Dạng sắp xếp câu kiểm cùng quy tắc một hàng.
    if (width <= 430) {
      const firstAnswer = page.locator('.qn-option').first();
      const radioBox = await firstAnswer
        .locator('input[type="radio"]')
        .boundingBox();
      const labelBox = await firstAnswer
        .locator('label.qn-option__radio')
        .boundingBox();
      const answerInput = await firstAnswer
        .locator('input.adm-input')
        .boundingBox();
      const removeBox = await firstAnswer
        .locator('button')
        .last()
        .boundingBox();
      expect(radioBox, 'radio').not.toBeNull();
      expect(labelBox, 'radio label').not.toBeNull();
      expect(answerInput, 'answer input').not.toBeNull();
      expect(removeBox, 'remove button').not.toBeNull();
      // G5: input radio nhỏ theo house pattern (≤24px), vùng chạm ở label ≥44px.
      expect(radioBox?.width ?? 0).toBeLessThanOrEqual(24);
      expect(radioBox?.height ?? 0).toBeLessThanOrEqual(24);
      expect(labelBox?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(labelBox?.height ?? 0).toBeGreaterThanOrEqual(44);
      // Tâm dọc radio và ô nhập lệch ≤4px; mép trên label/input/nút lệch ≤8px.
      const centerY = (box: { y: number; height: number }) =>
        box.y + box.height / 2;
      expect(
        Math.abs(centerY(radioBox!) - centerY(answerInput!)),
      ).toBeLessThanOrEqual(4);
      const tops = [labelBox, answerInput, removeBox]
        .filter((box): box is NonNullable<typeof box> => box !== null)
        .map((box) => box.y);
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(8);
      expect(answerInput?.width ?? 0).toBeGreaterThanOrEqual(180);
      expect(removeBox?.height ?? 0).toBeGreaterThanOrEqual(44);

      // G5: vùng chạm của label thật sự chọn được radio đáp án thứ 2 khi bấm
      // vào góc trên-trái (cách 4px), không cần bấm đúng vòng tròn.
      const secondLabel = page
        .locator('.qn-option')
        .nth(1)
        .locator('label.qn-option__radio');
      await secondLabel.click({ position: { x: 4, y: 4 } });
      await expect(page.getByLabel('Đáp án đúng là lựa chọn 2')).toBeChecked();

      await page
        .getByLabel('Loại câu hỏi')
        .selectOption({ label: 'Sắp xếp câu' });
      const firstToken = page.locator('.qn-token').first();
      const tokenInput = await firstToken
        .locator('input.adm-input')
        .boundingBox();
      const tokenRemove = await firstToken
        .locator('button')
        .last()
        .boundingBox();
      const tokenTops = [tokenInput, tokenRemove]
        .filter((box): box is NonNullable<typeof box> => box !== null)
        .map((box) => box.y);
      expect(
        Math.max(...tokenTops) - Math.min(...tokenTops),
      ).toBeLessThanOrEqual(8);
      expect(tokenRemove?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

async function createQuestion(
  page: Page,
  input: {
    type: string;
    content: string;
    kind: 'mcq' | 'true_false' | 'fill_blank' | 'arrange';
  },
): Promise<number> {
  await page.goto('/admin/questions/new');
  await page.getByLabel('Loại câu hỏi').selectOption({ label: input.type });
  await page.locator('#qn-content').fill(input.content);
  if (input.kind === 'mcq') {
    await page.getByLabel('Lựa chọn 1', { exact: true }).fill('Xin chào');
    await page.getByLabel('Lựa chọn 2', { exact: true }).fill('Tạm biệt');
    await page.getByLabel('Đáp án đúng là lựa chọn 1').check();
  } else if (input.kind === 'true_false') {
    await page.getByRole('radio', { name: 'Đúng', exact: true }).check();
  } else if (input.kind === 'fill_blank') {
    await page.getByLabel('Đáp án chấp nhận 1', { exact: true }).fill('học');
  } else {
    await page.getByLabel('Mảnh câu 1', { exact: true }).fill('我');
    await page.getByLabel('Mảnh câu 2', { exact: true }).fill('是');
  }
  await page.getByRole('button', { name: 'Tạo câu hỏi' }).click();
  await page.waitForURL(/\/admin\/questions\/\d+$/u);
  const match = /\/admin\/questions\/(\d+)$/u.exec(page.url());
  return Number(match?.[1]);
}
