import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('CMS concurrency harness production-path contract', () => {
  const harnessSource = readFileSync(
    resolve(process.cwd(), 'scripts/test/run-cms-lifecycle-concurrency.ts'),
    'utf8',
  );

  it('calls CmsService production lifecycle methods instead of a duplicate Prisma implementation', () => {
    expect(harnessSource).toContain("from '../../src/modules/cms/cms.service'");
    expect(harnessSource).toContain('.publishLessonRevision(');
    expect(harnessSource).toContain('.archiveLesson(');
    expect(harnessSource).toContain('.archiveTopic(');
    expect(harnessSource).toContain('.publishTopicRevision(');
    expect(harnessSource).toContain('.reviewLessonRevision(');
    expect(harnessSource).toContain('.createLessonRevision(');

    expect(harnessSource).not.toMatch(/function\s+lockLesson\s*\(/);
    expect(harnessSource).not.toMatch(/function\s+lockTopic\s*\(/);
    expect(harnessSource).not.toContain('.$transaction(');
    expect(harnessSource).not.toMatch(/transaction\.lesson\.update\s*\(/);
    expect(harnessSource).not.toMatch(/transaction\.topic\.update\s*\(/);
    expect(harnessSource).not.toMatch(
      /transaction\.contentReview\.create\s*\(/,
    );
    expect(harnessSource).not.toMatch(
      /transaction\.contentRevision\.create\s*\(/,
    );
  });
});
