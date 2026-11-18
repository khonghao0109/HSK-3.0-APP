import {
  ContentStatus,
  Prisma,
  PrismaClient,
  QuestionType,
  Skill,
} from '@prisma/client';

/**
 * Q357: nạp blueprint đề thi (`content/<level>/exam/blueprint-*.json`) và các bộ
 * câu dùng chung tranh/đáp án của một đề mẫu vào DB. Không có route CMS cho
 * blueprint/bộ câu nên ghi trực tiếp qua Prisma, idempotent theo `code`/`sourceKey`.
 * Blueprint đã `published` thì không ghi đè: đổi cấu trúc = tạo code/version mới.
 */
export interface BlueprintPartFile {
  readonly key: string;
  readonly title: string;
  readonly instruction: string | null;
  readonly questionType: string;
  readonly format: string;
  readonly questionCount: number;
  readonly fromSet: boolean;
}
export interface BlueprintSectionFile {
  readonly skill: string;
  readonly title: string;
  readonly instruction: string | null;
  readonly parts: readonly BlueprintPartFile[];
}
export interface BlueprintFileEntry {
  readonly code: string;
  readonly level: string;
  readonly title: string;
  readonly instruction: string | null;
  readonly durationMinutes: number;
  readonly passScore: number | null;
  readonly version: number;
  readonly status: string;
  readonly sections: readonly BlueprintSectionFile[];
}
export interface BlueprintFile {
  readonly schemaVersion: number;
  readonly blueprints: readonly BlueprintFileEntry[];
}

const SKILLS = new Set<string>(Object.values(Skill));
const TYPES = new Set<string>(Object.values(QuestionType));
const STATUSES = new Set<string>([
  ContentStatus.draft,
  ContentStatus.published,
]);
const CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

export function validateBlueprintFile(file: BlueprintFile): string[] {
  const issues: string[] = [];
  if (file.schemaVersion !== 1) issues.push('schemaVersion phải là 1');
  const codes = new Set<string>();
  for (const [b, bp] of (file.blueprints ?? []).entries()) {
    const at = `blueprints[${b}]`;
    if (!CODE.test(bp.code ?? '')) issues.push(`${at}.code sai định dạng`);
    if (codes.has(bp.code)) issues.push(`${at}.code trùng`);
    codes.add(bp.code);
    if (!bp.title?.trim()) issues.push(`${at}.title trống`);
    if (!Number.isInteger(bp.durationMinutes) || bp.durationMinutes < 1)
      issues.push(`${at}.durationMinutes phải nguyên dương`);
    if (!Number.isInteger(bp.version) || bp.version < 1)
      issues.push(`${at}.version phải nguyên dương`);
    if (!STATUSES.has(bp.status))
      issues.push(`${at}.status phải draft/published`);
    if (!bp.sections?.length) issues.push(`${at}.sections trống`);
    const maxScore = 100 * (bp.sections?.length ?? 0);
    if (
      bp.passScore !== null &&
      (!Number.isInteger(bp.passScore) ||
        bp.passScore < 0 ||
        bp.passScore > maxScore)
    )
      issues.push(`${at}.passScore ngoài 0..${maxScore}`);
    const keys = new Set<string>();
    for (const [s, section] of (bp.sections ?? []).entries()) {
      const sat = `${at}.sections[${s}]`;
      if (!SKILLS.has(section.skill)) issues.push(`${sat}.skill không hợp lệ`);
      if (!section.parts?.length) issues.push(`${sat}.parts trống`);
      for (const [p, part] of (section.parts ?? []).entries()) {
        const pat = `${sat}.parts[${p}]`;
        if (!part.key?.trim() || keys.has(part.key))
          issues.push(`${pat}.key trống hoặc trùng`);
        keys.add(part.key);
        if (!TYPES.has(part.questionType))
          issues.push(`${pat}.questionType không hợp lệ`);
        if (!SLUG.test(part.format ?? ''))
          issues.push(`${pat}.format phải là slug tag`);
        if (
          !Number.isInteger(part.questionCount) ||
          part.questionCount < 1 ||
          part.questionCount > 50
        )
          issues.push(`${pat}.questionCount ngoài 1..50`);
      }
    }
  }
  return issues;
}

type Db = PrismaClient | Prisma.TransactionClient;

async function levelId(db: Db, code: string): Promise<number> {
  const level = await db.level.findUnique({
    where: { code },
    select: { id: true },
  });
  if (!level) throw new Error(`Thiếu level ${code}`);
  return level.id;
}

/** Ghi blueprint; trả về `created`/`updated`/`unchanged`/`skipped_published`. */
export async function importBlueprints(
  prisma: PrismaClient,
  file: BlueprintFile,
): Promise<Record<string, string>> {
  const issues = validateBlueprintFile(file);
  if (issues.length) throw new Error(`Blueprint lỗi:\n${issues.join('\n')}`);
  const result: Record<string, string> = {};
  for (const bp of file.blueprints) {
    result[bp.code] = await prisma.$transaction(async (tx) => {
      const lid = await levelId(tx, bp.level);
      const existing = await tx.examBlueprint.findUnique({
        where: { code: bp.code },
        include: {
          sections: {
            orderBy: { orderIndex: 'asc' },
            include: { parts: { orderBy: { orderIndex: 'asc' } } },
          },
        },
      });
      const header = {
        levelId: lid,
        title: bp.title,
        instruction: bp.instruction,
        durationMinutes: bp.durationMinutes,
        passScore: bp.passScore,
        version: bp.version,
        status: bp.status as ContentStatus,
      };
      if (existing && sameBlueprint(existing, header, bp)) return 'unchanged';
      if (existing?.status === ContentStatus.published)
        return 'skipped_published';
      const id = existing
        ? (
            await tx.examBlueprint.update({
              where: { id: existing.id },
              data: header,
              select: { id: true },
            })
          ).id
        : (
            await tx.examBlueprint.create({
              data: { code: bp.code, ...header },
              select: { id: true },
            })
          ).id;
      await tx.examBlueprintSection.deleteMany({ where: { blueprintId: id } });
      for (const [s, section] of bp.sections.entries()) {
        await tx.examBlueprintSection.create({
          data: {
            blueprintId: id,
            skill: section.skill as Skill,
            title: section.title,
            instruction: section.instruction,
            orderIndex: s,
            parts: {
              create: section.parts.map((part, p) => ({
                key: part.key,
                title: part.title,
                instruction: part.instruction,
                orderIndex: p,
                questionType: part.questionType as QuestionType,
                format: part.format,
                questionCount: part.questionCount,
                fromSet: part.fromSet,
              })),
            },
          },
        });
      }
      return existing ? 'updated' : 'created';
    });
  }
  return result;
}

function sameBlueprint(
  existing: {
    levelId: number;
    title: string;
    instruction: string | null;
    durationMinutes: number;
    passScore: number | null;
    version: number;
    status: ContentStatus;
    sections: {
      skill: Skill;
      title: string;
      instruction: string | null;
      parts: {
        key: string;
        title: string;
        instruction: string | null;
        questionType: QuestionType;
        format: string;
        questionCount: number;
        fromSet: boolean;
      }[];
    }[];
  },
  header: Record<string, unknown>,
  bp: BlueprintFileEntry,
): boolean {
  const now = JSON.stringify({
    ...Object.fromEntries(
      Object.keys(header).map((k) => [
        k,
        (existing as Record<string, unknown>)[k],
      ]),
    ),
    sections: existing.sections.map((s) => ({
      skill: s.skill,
      title: s.title,
      instruction: s.instruction,
      parts: s.parts.map((p) => ({
        key: p.key,
        title: p.title,
        instruction: p.instruction,
        questionType: p.questionType,
        format: p.format,
        questionCount: p.questionCount,
        fromSet: p.fromSet,
      })),
    })),
  });
  const wanted = JSON.stringify({
    ...header,
    sections: bp.sections.map((s) => ({
      skill: s.skill,
      title: s.title,
      instruction: s.instruction,
      parts: s.parts.map((p) => ({
        key: p.key,
        title: p.title,
        instruction: p.instruction,
        questionType: p.questionType,
        format: p.format,
        questionCount: p.questionCount,
        fromSet: p.fromSet,
      })),
    })),
  });
  return now === wanted;
}

export interface ExamSetSource {
  readonly test: { readonly sourceKey: string };
  readonly sections: readonly {
    readonly skill: string;
    readonly parts: readonly {
      readonly key: string;
      /** Phần blueprint (mặc định = key) khi một file có nhiều bộ cùng dạng. */
      readonly blueprintPart?: string;
      readonly title: string;
      readonly instruction: string;
      readonly imageKey: string | null;
      readonly questions: readonly { readonly sourceKey: string }[];
    }[];
  }[];
}

export interface ExamSetLedger {
  readonly media: Record<string, { id: number }>;
  readonly questions: Record<string, { id: number }>;
}

/**
 * Mỗi phần của đề mẫu mà blueprint đánh dấu `fromSet` thành một `QuestionSet`
 * (`<test.sourceKey>:<part.key>`), id câu/ảnh lấy từ sổ nạp đề của môi trường.
 * Trạng thái bộ = `published` khi mọi câu đã published, ngược lại `draft`.
 */
export async function importQuestionSets(
  prisma: PrismaClient,
  input: {
    blueprints: BlueprintFile;
    exam: ExamSetSource;
    ledger: ExamSetLedger;
    level: string;
  },
): Promise<Record<string, string>> {
  const setFormats = new Map<string, string>();
  for (const bp of input.blueprints.blueprints)
    for (const section of bp.sections)
      for (const part of section.parts)
        if (part.fromSet) setFormats.set(part.key, part.format);
  const result: Record<string, string> = {};
  const lid = await levelId(prisma, input.level);
  for (const section of input.exam.sections) {
    for (const part of section.parts) {
      const format = setFormats.get(part.blueprintPart ?? part.key);
      if (!format) continue;
      const sourceKey = `${input.exam.test.sourceKey}:${part.key}`;
      const questionIds = part.questions.map((question) => {
        const id = input.ledger.questions[question.sourceKey]?.id;
        if (id === undefined)
          throw new Error(`${sourceKey}: sổ thiếu câu ${question.sourceKey}`);
        return id;
      });
      const imageId =
        part.imageKey === null
          ? null
          : (input.ledger.media[part.imageKey]?.id ?? null);
      if (part.imageKey !== null && imageId === null)
        throw new Error(`${sourceKey}: sổ thiếu ảnh ${part.imageKey}`);
      result[sourceKey] = await prisma.$transaction(async (tx) => {
        const questions = await tx.question.findMany({
          where: { id: { in: questionIds } },
          select: { id: true, status: true, deletedAt: true, setItem: true },
        });
        if (questions.length !== questionIds.length)
          throw new Error(`${sourceKey}: thiếu câu trong DB`);
        const status = questions.every(
          (q) => q.status === ContentStatus.published && q.deletedAt === null,
        )
          ? ContentStatus.published
          : ContentStatus.draft;
        const data = {
          levelId: lid,
          skill: section.skill as Skill,
          format,
          title: part.title,
          instruction: part.instruction,
          imageId,
          status,
        };
        const set = await tx.questionSet.upsert({
          where: { sourceKey },
          create: { sourceKey, ...data },
          update: data,
          select: { id: true },
        });
        for (const q of questions) {
          if (q.setItem && q.setItem.setId !== set.id)
            throw new Error(`${sourceKey}: câu ${q.id} đã thuộc bộ khác`);
        }
        await tx.questionSetItem.deleteMany({ where: { setId: set.id } });
        await tx.questionSetItem.createMany({
          data: questionIds.map((questionId, orderIndex) => ({
            setId: set.id,
            questionId,
            orderIndex,
          })),
        });
        return status;
      });
    }
  }
  return result;
}
