// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// V5 (M2.10c): sprite icon sống trong `layout.tsx` (server component, không
// render được bằng testing-library cho gọn), nên guard này đọc nguồn và đối
// chiếu: 5 symbol mới phải có, đủ 24 id của 10 trang mẫu web công khai, và mọi
// `<use href="#i-…">` trong `src` phải trỏ tới symbol có thật.
//
// Không đọc `docs/ui_reference/` trong test: thư mục đó bị `.gitignore` nên CI
// không có (xem danh sách id bên dưới).

const srcRoot = resolve(process.cwd(), 'src');
const layoutPath = resolve(srcRoot, 'app/(learner)/layout.tsx');

/** 24 id `#i-…` grep trên 10 trang `docs/ui_reference/web/*.html` (bản local,
 * gitignored), đếm 14/10/2026. */
const PUBLIC_SAMPLE_ICON_IDS = [
  'i-alert-triangle',
  'i-arrow-left',
  'i-arrow-right',
  'i-bell',
  'i-book-open',
  'i-check',
  'i-check-circle',
  'i-check-circle-line',
  'i-chevron-down',
  'i-chevron-right',
  'i-clipboard-check',
  'i-clock',
  'i-eye',
  'i-file-text',
  'i-info',
  'i-layers',
  'i-lock',
  'i-mail',
  'i-mic',
  'i-search',
  'i-sparkles',
  'i-star-fill',
  'i-target',
  'i-trophy',
];

/** Năm symbol mà bản mẫu dùng nhưng sprite còn thiếu trước V5. */
const ADDED_ICONS = [
  'i-check-circle-line',
  'i-chevron-down',
  'i-info',
  'i-target',
  'i-clipboard-check',
];

const layoutSource = readFileSync(layoutPath, 'utf8');
const spriteIds = new Set(
  Array.from(layoutSource.matchAll(/id="(i-[a-z0-9-]+)"/g))
    .map((match) => match[1])
    .filter((id): id is string => Boolean(id)),
);

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (
      ['.ts', '.tsx'].includes(extname(full)) &&
      !full.includes('.spec.')
    ) {
      files.push(full);
    }
  }
  return files;
}

function iconReferences(source: string): string[] {
  return Array.from(source.matchAll(/#(i-[a-z0-9-]+)/g))
    .map((match) => match[1])
    .filter((id): id is string => Boolean(id));
}

describe('sprite icon của khung learner (M2.10c, V5)', () => {
  it('có đủ 5 symbol mà 10 trang mẫu web công khai dùng', () => {
    const missing = ADDED_ICONS.filter((id) => !spriteIds.has(id));
    expect(missing).toEqual([]);
  });

  // 24 id = grep `#i-` trên 10 trang docs/ui_reference/web/*.html (bản local,
  // gitignored), đếm 14/10/2026. Chép vào đây vì `docs/ui_reference/` bị
  // `.gitignore` nên CI không có file mẫu để đọc; danh sách này giữ nguyên bảo
  // vệ "0 id thiếu" trên CI.
  it('không thiếu symbol nào so với 10 trang mẫu web công khai', () => {
    expect(PUBLIC_SAMPLE_ICON_IDS).toHaveLength(24);
    const missing = PUBLIC_SAMPLE_ICON_IDS.filter(
      (id) => !spriteIds.has(id),
    ).sort();
    expect(missing).toEqual([]);
  });

  it('mọi <use href="#i-…"> trong src đều trỏ tới symbol có thật', () => {
    const missing = new Set<string>();
    for (const file of listSourceFiles(srcRoot)) {
      const source = readFileSync(file, 'utf8');
      for (const id of iconReferences(source)) {
        if (!spriteIds.has(id)) missing.add(`${id} (${file})`);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
