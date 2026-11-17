import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalJson } from '../../common/utils/canonical-json';

/**
 * Sinh audio offline cho nội dung đã duyệt (Q184/Q348, lát cắt Bài 1 + đề thi).
 *
 * Manifest liệt kê từng file audio theo `sourceKey`. Script chỉ chạy khi
 * `review.status = "approved"` có người duyệt, ngày và `contentSha256` khớp nội
 * dung (giống lô nghĩa P1). Đầu ra mp3 (media pipeline chỉ nhận mp3/wav) đặt
 * tên ổn định theo `sourceKey`; `checksums.json` ghi sha256 của file và của
 * đầu vào để chạy lại không sinh lại file đã có.
 */

export interface TtsTurn {
  readonly voice: string;
  readonly text: string;
}

export interface TtsItem {
  readonly sourceKey: string;
  /** Một giọng: `voice` + `text`. Hội thoại nhiều giọng: `turns`. */
  readonly voice?: string;
  readonly text?: string;
  readonly turns?: readonly TtsTurn[];
  /** Tốc độ SSML, ví dụ "0%" (chuẩn). */
  readonly rate?: string;
  /** Nghỉ giữa các lượt thoại, mili giây. */
  readonly breakMs?: number;
}

export interface TtsManifest {
  readonly schemaVersion: 1;
  readonly manifestId: string;
  readonly provider: 'azure';
  readonly language: 'zh-CN';
  readonly dataSource: {
    readonly code: string;
    readonly name: string;
    readonly version: string;
    readonly license: string;
    readonly attribution: string;
  };
  review: {
    status: 'pending' | 'approved' | 'changes_requested';
    reviewer: string | null;
    reviewedAt: string | null;
    contentSha256: string | null;
  };
  readonly items: readonly TtsItem[];
}

export interface ChecksumEntry {
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly inputSha256: string;
  readonly voices: readonly string[];
  readonly provider: string;
  readonly generatedAt: string;
}

export type Checksums = Record<string, ChecksumEntry>;

/** Nguồn sinh audio; test dùng provider giả, máy thật dùng Azure. */
export interface TtsProvider {
  readonly name: string;
  synthesize(ssml: string): Promise<Buffer>;
}

export class TtsError extends Error {}

const SOURCE_KEY = /^[a-z0-9][a-z0-9:._-]{0,127}$/u;
const VOICE = /^zh-CN-[A-Za-z]+Neural$/u;
const RATE = /^[+-]?\d{1,3}%$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_TEXT = 1000;

export function manifestContentSha256(manifest: TtsManifest): string {
  const { manifestId, provider, language, dataSource, items } = manifest;
  return createHash('sha256')
    .update(
      canonicalJson({ manifestId, provider, language, dataSource, items }),
    )
    .digest('hex');
}

export function itemInputSha256(item: TtsItem): string {
  return createHash('sha256').update(buildSsml(item)).digest('hex');
}

export function fileNameFor(sourceKey: string): string {
  return `${sourceKey.replace(/[:]/gu, '_')}.mp3`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

function turnsOf(item: TtsItem): readonly TtsTurn[] {
  if (item.turns !== undefined) return item.turns;
  return [{ voice: item.voice ?? '', text: item.text ?? '' }];
}

/** SSML: mỗi lượt một thẻ `<voice>`; văn bản luôn được escape. */
export function buildSsml(item: TtsItem): string {
  const rate = item.rate ?? '0%';
  const turns = turnsOf(item);
  const parts = turns.map((turn, index) => {
    const pause =
      index < turns.length - 1 && item.breakMs !== undefined
        ? `<break time="${item.breakMs}ms"/>`
        : '';
    return `<voice name="${turn.voice}"><prosody rate="${rate}">${escapeXml(turn.text)}</prosody>${pause}</voice>`;
  });
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">${parts.join('')}</speak>`;
}

export function validateManifest(raw: unknown): string[] {
  const errors: string[] = [];
  const m = raw as Partial<TtsManifest> | null;
  if (m === null || typeof m !== 'object')
    return ['manifest không phải object'];
  if (m.schemaVersion !== 1) errors.push('schemaVersion phải là 1');
  if (m.provider !== 'azure') errors.push('provider phải là azure');
  if (m.language !== 'zh-CN') errors.push('language phải là zh-CN');
  if (typeof m.manifestId !== 'string' || !SOURCE_KEY.test(m.manifestId)) {
    errors.push('manifestId không hợp lệ');
  }
  const ds = m.dataSource;
  for (const key of [
    'code',
    'name',
    'version',
    'license',
    'attribution',
  ] as const) {
    if (typeof ds?.[key] !== 'string' || ds[key].trim() === '') {
      errors.push(`dataSource.${key} bắt buộc`);
    }
  }
  if (!Array.isArray(m.items) || m.items.length === 0) {
    errors.push('items rỗng');
    return errors;
  }
  const seen = new Set<string>();
  const items: readonly TtsItem[] = m.items;
  items.forEach((item, index) => {
    const at = `items[${index}]`;
    if (
      typeof item.sourceKey !== 'string' ||
      !SOURCE_KEY.test(item.sourceKey)
    ) {
      errors.push(`${at}.sourceKey không hợp lệ`);
    } else if (seen.has(item.sourceKey)) {
      errors.push(`${at}.sourceKey trùng: ${item.sourceKey}`);
    } else {
      seen.add(item.sourceKey);
    }
    const single = item.text !== undefined || item.voice !== undefined;
    if (single === (item.turns !== undefined)) {
      errors.push(`${at}: dùng đúng một trong (voice + text) hoặc turns`);
      return;
    }
    if (item.rate !== undefined && !RATE.test(item.rate)) {
      errors.push(`${at}.rate không hợp lệ`);
    }
    if (
      item.breakMs !== undefined &&
      (!Number.isInteger(item.breakMs) ||
        item.breakMs < 0 ||
        item.breakMs > 5000)
    ) {
      errors.push(`${at}.breakMs phải là số nguyên 0–5000`);
    }
    turnsOf(item).forEach((turn, turnIndex) => {
      const where = item.turns === undefined ? at : `${at}.turns[${turnIndex}]`;
      if (typeof turn.voice !== 'string' || !VOICE.test(turn.voice)) {
        errors.push(`${where}.voice phải là giọng zh-CN neural`);
      }
      if (
        typeof turn.text !== 'string' ||
        turn.text.trim() === '' ||
        turn.text.length > MAX_TEXT
      ) {
        errors.push(`${where}.text rỗng hoặc dài quá ${MAX_TEXT}`);
      }
    });
  });
  return errors;
}

/** Chỉ văn bản đã duyệt mới được sinh audio. */
export function approvalErrors(manifest: TtsManifest): string[] {
  const review = manifest.review;
  const errors: string[] = [];
  if (review?.status !== 'approved') errors.push('review.status chưa approved');
  if (typeof review?.reviewer !== 'string' || review.reviewer.trim() === '') {
    errors.push('thiếu review.reviewer');
  }
  if (typeof review?.reviewedAt !== 'string' || !DATE.test(review.reviewedAt)) {
    errors.push('review.reviewedAt phải là YYYY-MM-DD');
  }
  if (review?.contentSha256 !== manifestContentSha256(manifest)) {
    errors.push(
      'review.contentSha256 không khớp nội dung (nội dung đổi sau khi duyệt)',
    );
  }
  return errors;
}

export interface TtsRunOptions {
  readonly outputDir: string;
  readonly checksumsPath: string;
  readonly dryRun: boolean;
  readonly now: () => Date;
  readonly log?: (line: string) => void;
}

export interface TtsRunResult {
  readonly generated: string[];
  readonly skipped: string[];
  readonly planned: string[];
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function readChecksums(path: string): Checksums {
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Checksums)
    : {};
}

/**
 * Idempotent: bỏ qua item khi file đã có, sha256 khớp `checksums.json` và đầu
 * vào (SSML) không đổi. Ghi `checksums.json` sau mỗi file để dừng giữa chừng
 * vẫn giữ được phần đã sinh.
 */
export async function runTts(
  manifest: TtsManifest,
  provider: TtsProvider,
  options: TtsRunOptions,
): Promise<TtsRunResult> {
  const invalid = validateManifest(manifest);
  if (invalid.length > 0) throw new TtsError(invalid.join('; '));
  const unapproved = approvalErrors(manifest);
  if (unapproved.length > 0) throw new TtsError(unapproved.join('; '));

  const log = options.log ?? (() => undefined);
  const checksums = readChecksums(options.checksumsPath);
  const result: TtsRunResult = { generated: [], skipped: [], planned: [] };
  if (!options.dryRun) mkdirSync(options.outputDir, { recursive: true });

  for (const item of manifest.items) {
    const file = fileNameFor(item.sourceKey);
    const path = join(options.outputDir, file);
    const inputSha256 = itemInputSha256(item);
    const known = checksums[item.sourceKey];
    if (
      known !== undefined &&
      known.inputSha256 === inputSha256 &&
      existsSync(path) &&
      sha256(readFileSync(path)) === known.sha256
    ) {
      result.skipped.push(item.sourceKey);
      continue;
    }
    if (options.dryRun) {
      result.planned.push(item.sourceKey);
      log(`dry-run: sẽ sinh ${file}`);
      continue;
    }
    const audio = await provider.synthesize(buildSsml(item));
    if (audio.length === 0) throw new TtsError(`${item.sourceKey}: audio rỗng`);
    writeFileSync(path, audio);
    checksums[item.sourceKey] = {
      file,
      sha256: sha256(audio),
      bytes: audio.length,
      inputSha256,
      voices: [...new Set(turnsOf(item).map((turn) => turn.voice))],
      provider: provider.name,
      generatedAt: options.now().toISOString().slice(0, 10),
    };
    writeFileSync(
      options.checksumsPath,
      `${JSON.stringify(sortKeys(checksums), null, 2)}\n`,
    );
    result.generated.push(item.sourceKey);
    log(`đã sinh ${file} (${audio.length} byte)`);
  }
  return result;
}

function sortKeys(checksums: Checksums): Checksums {
  return Object.fromEntries(
    Object.keys(checksums)
      .sort()
      .map((key) => [key, checksums[key]]),
  );
}

/** Azure AI Speech REST (real-time synthesis). Key không bao giờ được log. */
export function azureProvider(
  key: string,
  region: string,
  fetchImpl: typeof fetch = fetch,
): TtsProvider {
  if (!/^[a-z0-9]+$/u.test(region))
    throw new TtsError('AZURE_SPEECH_REGION không hợp lệ');
  return {
    name: 'azure-ai-speech',
    async synthesize(ssml) {
      const response = await fetchImpl(
        `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': key,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
            'User-Agent': 'hsk30-content-tts',
          },
          body: ssml,
        },
      );
      if (!response.ok) {
        throw new TtsError(`Azure TTS trả ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
