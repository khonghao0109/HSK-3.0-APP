import { createHash } from 'node:crypto';

/**
 * Q357: chọn câu cho một đề theo blueprint (hàm thuần, tái lập được theo seed).
 * - Phần thường: câu lẻ (không thuộc bộ) có tag `format`, ưu tiên câu ít được
 *   dùng trong các đề khác, tránh trùng từ đích (`targetWordIds`) trong cùng đề,
 *   rồi xếp dễ → khó.
 * - Phần `fromSet`: lấy trọn một `QuestionSet` đúng `format`, đủ `questionCount`
 *   câu dùng được, giữ thứ tự trong bộ.
 */
export type PlanSkill = 'listening' | 'reading' | 'writing' | 'speaking';

export interface PlanPart {
  readonly key: string;
  readonly title: string;
  readonly instruction: string | null;
  readonly questionType: string;
  readonly format: string;
  readonly questionCount: number;
  readonly fromSet: boolean;
}

export interface PlanSection {
  readonly skill: PlanSkill;
  readonly title: string;
  readonly instruction: string | null;
  readonly parts: readonly PlanPart[];
}

export interface PoolQuestion {
  readonly id: number;
  readonly type: string;
  readonly skill: PlanSkill;
  readonly tags: readonly string[];
  readonly difficulty: number | null;
  readonly setId: number | null;
  readonly targetWordIds: readonly number[];
  /** Số đề (chưa archive) đang dùng câu này. */
  readonly usage: number;
}

export interface PoolSet {
  readonly id: number;
  readonly skill: PlanSkill;
  readonly format: string;
  readonly imageId: number | null;
  readonly audioId: number | null;
  /** Mọi câu của bộ theo thứ tự trong bộ. */
  readonly questionIds: readonly number[];
}

export interface PlannedGroup {
  readonly partKey: string;
  readonly title: string;
  readonly instruction: string | null;
  readonly setId: number | null;
  readonly imageId: number | null;
  readonly audioId: number | null;
  readonly questionIds: number[];
}

export interface PlannedSection {
  readonly skill: PlanSkill;
  readonly title: string;
  readonly instruction: string | null;
  readonly groups: PlannedGroup[];
}

export type PlanResult =
  | { readonly ok: true; readonly sections: PlannedSection[] }
  | {
      readonly ok: false;
      readonly partKey: string;
      readonly needed: number;
      readonly available: number;
      readonly fromSet: boolean;
    };

export interface PlanOptions {
  readonly seed: string;
  /** Câu không được dùng (vd. câu của đề trước để sinh đề khác hẳn). */
  readonly excludeQuestionIds?: ReadonlySet<number>;
}

/** PRNG mulberry32 khởi tạo từ sha256(seed). */
export function seededRandom(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function planExam(
  sections: readonly PlanSection[],
  questions: readonly PoolQuestion[],
  sets: readonly PoolSet[],
  options: PlanOptions,
): PlanResult {
  const random = seededRandom(options.seed);
  const excluded = options.excludeQuestionIds ?? new Set<number>();
  const byId = new Map(questions.map((question) => [question.id, question]));
  const used = new Set<number>();
  const usedWords = new Set<number>();
  const usedSets = new Set<number>();
  const take = (question: PoolQuestion) => {
    used.add(question.id);
    for (const word of question.targetWordIds) usedWords.add(word);
  };
  const out: PlannedSection[] = [];

  for (const section of sections) {
    const groups: PlannedGroup[] = [];
    for (const part of section.parts) {
      const fits = (question: PoolQuestion | undefined) =>
        question !== undefined &&
        question.skill === section.skill &&
        question.type === part.questionType &&
        !used.has(question.id) &&
        !excluded.has(question.id);

      if (part.fromSet) {
        const candidates = shuffled(
          sets.filter(
            (set) =>
              !usedSets.has(set.id) &&
              set.skill === section.skill &&
              set.format === part.format &&
              set.questionIds.length === part.questionCount &&
              set.questionIds.every((id) => fits(byId.get(id))),
          ),
          random,
        ).sort(
          (a, b) =>
            Math.max(...a.questionIds.map((id) => byId.get(id)?.usage ?? 0)) -
            Math.max(...b.questionIds.map((id) => byId.get(id)?.usage ?? 0)),
        );
        const chosen = candidates[0];
        if (!chosen) {
          return {
            ok: false,
            partKey: part.key,
            needed: part.questionCount,
            available: 0,
            fromSet: true,
          };
        }
        usedSets.add(chosen.id);
        for (const id of chosen.questionIds) take(byId.get(id) as PoolQuestion);
        groups.push({
          partKey: part.key,
          title: part.title,
          instruction: part.instruction,
          setId: chosen.id,
          imageId: chosen.imageId,
          audioId: chosen.audioId,
          questionIds: [...chosen.questionIds],
        });
        continue;
      }

      const candidates = shuffled(
        questions.filter(
          (question) =>
            question.setId === null &&
            question.tags.includes(part.format) &&
            fits(question),
        ),
        random,
      ).sort((a, b) => a.usage - b.usage);
      if (candidates.length < part.questionCount) {
        return {
          ok: false,
          partKey: part.key,
          needed: part.questionCount,
          available: candidates.length,
          fromSet: false,
        };
      }
      const picked: PoolQuestion[] = [];
      // Lượt 1: không trùng từ đích; lượt 2: lấp chỗ còn thiếu.
      for (const strict of [true, false]) {
        for (const question of candidates) {
          if (picked.length === part.questionCount) break;
          if (picked.includes(question)) continue;
          if (
            strict &&
            question.targetWordIds.some((word) => usedWords.has(word))
          )
            continue;
          picked.push(question);
          take(question);
        }
      }
      picked.sort(
        (a, b) =>
          (a.difficulty ?? Number.MAX_SAFE_INTEGER) -
            (b.difficulty ?? Number.MAX_SAFE_INTEGER) || a.id - b.id,
      );
      groups.push({
        partKey: part.key,
        title: part.title,
        instruction: part.instruction,
        setId: null,
        imageId: null,
        audioId: null,
        questionIds: picked.map((question) => question.id),
      });
    }
    out.push({
      skill: section.skill,
      title: section.title,
      instruction: section.instruction,
      groups,
    });
  }
  return { ok: true, sections: out };
}
