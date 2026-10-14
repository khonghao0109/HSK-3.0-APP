// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// V5 (M2.10c): sprite icon sống trong `layout.tsx` (server component, không
// render được bằng testing-library cho gọn), nên guard này đọc nguồn và đối
// chiếu ba chiều: 5 symbol mới phải có, mọi `#i-…` của 10 trang mẫu web công
// khai phải có symbol, và mọi `<use href="#i-…">` trong `src` phải trỏ tới
// symbol có thật.

const srcRoot = resolve(process.cwd(), 'src');
const layoutPath = resolve(srcRoot, 'app/(learner)/layout.tsx');
const repoRoot = resolve(process.cwd(), '..');
const sampleDir = resolve(repoRoot, 'docs/ui_reference/web');

/** 10 trang mẫu web công khai của M2.10c (PO Q81). */
const SAMPLE_PAGES = [
  'index',
  'sign-in',
  'sign-up',
  'forgot-password',
  'reset-password',
  'verify-email',
  'onboarding-goal',
  'onboarding-plan',
  'terms',
  'privacy',
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

  it('không thiếu symbol nào so với 10 trang mẫu web công khai', () => {
    const referenced = new Set<string>();
    for (const page of SAMPLE_PAGES) {
      const html = readFileSync(join(sampleDir, `${page}.html`), 'utf8');
      for (const id of iconReferences(html)) referenced.add(id);
    }
    expect(referenced.size).toBeGreaterThan(20);
    const missing = [...referenced].filter((id) => !spriteIds.has(id)).sort();
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
