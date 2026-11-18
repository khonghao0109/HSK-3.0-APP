import type { BlueprintFile } from './exam-blueprint';
import { syllableCounts } from './meaning-batch';

/**
 * Q357: kiểm file câu hỏi thi (đề mẫu `mock-*.json`, ngân hàng `bank-*.json`) trước
 * khi nạp: cấu trúc câu, bộ câu dùng chung đáp án (mỗi đáp án một lần, đúng số đáp
 * án thừa), tag dạng câu theo blueprint, số âm tiết pinyin trong ngoặc khớp số chữ
 * Hán, sourceKey và đề bài không trùng giữa các file.
 */
export interface BankOption {
  readonly id: string;
  readonly text: string;
}
export interface BankQuestion {
  readonly sourceKey: string;
  readonly type: string;
  readonly prompt: string;
  readonly options: readonly BankOption[];
  readonly answer: { readonly optionId: string };
  readonly explanation: string;
  readonly difficulty: number;
  readonly tags: readonly string[];
}
export interface BankPart {
  readonly key: string;
  /** Phần blueprint mà phần này thuộc về; mặc định = `key`. */
  readonly blueprintPart?: string;
  readonly questions: readonly BankQuestion[];
}
export interface BankFile {
  readonly test: { readonly sourceKey: string };
  readonly sections: readonly {
    readonly skill: string;
    readonly parts: readonly BankPart[];
  }[];
}

export interface BankIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

const HAN = /\p{Script=Han}/gu;
const SOURCE_KEY = /^[a-z0-9]+(:[a-z0-9-]+)+$/u;
/** "汉字 (pinyin)" – pinyin kết thúc ở ")" cuối đoạn hoặc trước " ★ ". */
const ANNOTATED = /([^★]*?)\s\((.+?)\)(?=\s★|$)/gu;

export const partBlueprintKey = (part: BankPart) =>
  part.blueprintPart ?? part.key;

const hanCount = (text: string) => (text.match(HAN) ?? []).length;
const hanOnly = (text: string) => (text.match(HAN) ?? []).join('');

/** Kiểm một chuỗi "chữ Hán (pinyin)": số âm tiết pinyin = số chữ Hán. */
export function annotationIssues(
  text: string,
  syllables: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  const segments = [...text.matchAll(ANNOTATED)];
  if (hanCount(text) > 0 && segments.length === 0)
    return ['thiếu pinyin trong ngoặc'];
  for (const [, han, pinyin] of segments) {
    const count = hanCount(han ?? '');
    if (count === 0) continue;
    if (!syllableCounts(pinyin ?? '', syllables).has(count))
      out.push(
        `«${(han ?? '').trim()}»: số âm tiết pinyin không khớp ${count} chữ`,
      );
  }
  return out;
}

export function validateBankFiles(
  files: readonly { readonly path: string; readonly file: BankFile }[],
  blueprints: BlueprintFile,
  syllables: ReadonlySet<string>,
): BankIssue[] {
  const issues: BankIssue[] = [];
  const add = (code: string, path: string, message: string) =>
    issues.push({ code, path, message });
  const parts = new Map<
    string,
    { format: string; fromSet: boolean; questionCount: number; skill: string }
  >();
  for (const bp of blueprints.blueprints)
    for (const section of bp.sections)
      for (const part of section.parts)
        parts.set(part.key, { ...part, skill: section.skill });

  const keys = new Map<string, string>();
  const prompts = new Map<string, string>();
  for (const { path, file } of files) {
    for (const [s, section] of file.sections.entries()) {
      for (const [p, part] of section.parts.entries()) {
        const at = `${path}#sections[${s}].parts[${p}]`;
        const spec = parts.get(partBlueprintKey(part));
        if (!spec) {
          add(
            'part_unknown',
            at,
            `${partBlueprintKey(part)} không có trong blueprint`,
          );
          continue;
        }
        if (spec.skill !== section.skill)
          add('part_skill_mismatch', at, `${spec.skill} ≠ ${section.skill}`);
        for (const [q, question] of part.questions.entries()) {
          const qat = `${at}.questions[${q}]`;
          if (!SOURCE_KEY.test(question.sourceKey))
            add('source_key_invalid', qat, question.sourceKey);
          const seen = keys.get(question.sourceKey);
          if (seen) add('source_key_duplicate', qat, `trùng ${seen}`);
          keys.set(question.sourceKey, qat);
          if (question.type !== 'mcq')
            add('type_unsupported', qat, question.type);
          if (!question.tags.includes(spec.format))
            add('format_tag_missing', qat, `thiếu tag ${spec.format}`);
          if (!question.explanation?.trim())
            add('explanation_missing', qat, 'trống');
          if (
            !Number.isInteger(question.difficulty) ||
            question.difficulty < 1 ||
            question.difficulty > 5
          )
            add('difficulty_invalid', qat, String(question.difficulty));
          const ids = question.options.map((option) => option.id);
          if (ids.length < 3 || new Set(ids).size !== ids.length)
            add('options_invalid', qat, 'cần ≥ 3 phương án, id không trùng');
          if (!ids.includes(question.answer.optionId))
            add('answer_missing', qat, question.answer.optionId);
          for (const text of [
            question.prompt,
            ...question.options.map((option) => option.text),
          ])
            for (const message of annotationIssues(text, syllables))
              add('pinyin_mismatch', qat, message);
          const han = hanOnly(question.prompt);
          if (han.length > 0) {
            const dup = prompts.get(han);
            if (dup) add('prompt_duplicate', qat, `trùng ${dup}`);
            prompts.set(han, qat);
          }
        }
        if (!spec.fromSet) continue;
        if (part.questions.length !== spec.questionCount)
          add(
            'set_size',
            at,
            `bộ cần ${spec.questionCount} câu, có ${part.questions.length}`,
          );
        const first = JSON.stringify(part.questions[0]?.options ?? []);
        if (part.questions.some((q) => JSON.stringify(q.options) !== first))
          add(
            'set_options_differ',
            at,
            'các câu trong bộ phải dùng chung phương án',
          );
        const answers = part.questions.map((q) => q.answer.optionId);
        if (new Set(answers).size !== answers.length)
          add('set_answer_reused', at, 'mỗi phương án chỉ đúng cho một câu');
        const optionCount = part.questions[0]?.options.length ?? 0;
        if (optionCount - part.questions.length !== 1)
          add('set_extra_option', at, 'cần đúng một phương án thừa');
      }
    }
  }
  return issues;
}
