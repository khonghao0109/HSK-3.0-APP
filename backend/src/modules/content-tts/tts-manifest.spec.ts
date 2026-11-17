import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  approvalErrors,
  azureProvider,
  buildSsml,
  fileNameFor,
  manifestContentSha256,
  runTts,
  type TtsManifest,
  type TtsProvider,
  validateManifest,
} from './tts-manifest';

function manifest(): TtsManifest {
  const m: TtsManifest = {
    schemaVersion: 1,
    manifestId: 'hsk1-slice-01',
    provider: 'azure',
    language: 'zh-CN',
    dataSource: {
      code: 'HSK30_TTS_AZURE_SLICE01',
      name: 'Audio TTS Azure lát cắt 01',
      version: '1',
      license: 'Azure AI Speech output (Customer Data)',
      attribution: 'Giọng đọc tổng hợp (Azure AI Speech)',
    },
    review: {
      status: 'pending',
      reviewer: null,
      reviewedAt: null,
      contentSha256: null,
    },
    items: [
      { sourceKey: 'hsk1:l01:w01', voice: 'zh-CN-XiaoxiaoNeural', text: '我' },
      {
        sourceKey: 'hsk1:l01:dialogue',
        turns: [
          { voice: 'zh-CN-YunxiNeural', text: '你好！' },
          { voice: 'zh-CN-XiaoxiaoNeural', text: '你好 <&>' },
        ],
        breakMs: 400,
      },
    ],
  };
  return m;
}

function approved(): TtsManifest {
  const m = manifest();
  m.review = {
    status: 'approved',
    reviewer: 'Người duyệt',
    reviewedAt: '2026-11-18',
    contentSha256: manifestContentSha256(m),
  };
  return m;
}

function fakeProvider(): TtsProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: 'fake',
    calls,
    synthesize(ssml) {
      calls.push(ssml);
      return Promise.resolve(Buffer.from(`ID3${ssml.length}`));
    },
  };
}

const now = () => new Date('2026-11-18T08:00:00Z');

describe('TTS manifest (Q348)', () => {
  it('builds escaped SSML with one <voice> per turn and breaks between turns', () => {
    const ssml = buildSsml(manifest().items[1]);
    expect(ssml).toContain('<voice name="zh-CN-YunxiNeural">');
    expect(ssml).toContain('你好 &lt;&amp;&gt;');
    expect(ssml.match(/<break time="400ms"\/>/gu)).toHaveLength(1);
    expect(fileNameFor('hsk1:l01:w01')).toBe('hsk1_l01_w01.mp3');
  });

  it('rejects malformed items', () => {
    const m = manifest() as unknown as { items: unknown[] };
    m.items = [
      { sourceKey: 'A B', voice: 'en-US-Jenny', text: '' },
      { sourceKey: 'ok', voice: 'zh-CN-XiaoxiaoNeural', text: 'x', turns: [] },
    ];
    expect(validateManifest(m)).toEqual(
      expect.arrayContaining([
        'items[0].sourceKey không hợp lệ',
        'items[0].voice phải là giọng zh-CN neural',
        'items[1]: dùng đúng một trong (voice + text) hoặc turns',
      ]),
    );
  });

  it('refuses unapproved or changed manifests and never calls the provider', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tts-'));
    const provider = fakeProvider();
    const options = {
      outputDir: dir,
      checksumsPath: join(dir, 'checksums.json'),
      dryRun: false,
      now,
    };
    await expect(runTts(manifest(), provider, options)).rejects.toThrow(
      'review.status chưa approved',
    );
    const changed = approved();
    (changed.items[0] as { text: string }).text = '你';
    expect(approvalErrors(changed)).toEqual([
      'review.contentSha256 không khớp nội dung (nội dung đổi sau khi duyệt)',
    ]);
    await expect(runTts(changed, provider, options)).rejects.toThrow(
      'không khớp',
    );
    expect(provider.calls).toHaveLength(0);
  });

  it('generates once, records checksums, skips on rerun and regenerates a tampered file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tts-'));
    const checksumsPath = join(dir, 'checksums.json');
    const provider = fakeProvider();
    const options = { outputDir: dir, checksumsPath, dryRun: false, now };

    const dry = await runTts(approved(), provider, {
      ...options,
      dryRun: true,
    });
    expect(dry.planned).toHaveLength(2);
    expect(provider.calls).toHaveLength(0);

    const first = await runTts(approved(), provider, options);
    expect(first.generated).toEqual(['hsk1:l01:w01', 'hsk1:l01:dialogue']);
    const checksums = JSON.parse(readFileSync(checksumsPath, 'utf8'));
    expect(checksums['hsk1:l01:w01']).toMatchObject({
      file: 'hsk1_l01_w01.mp3',
      provider: 'fake',
      voices: ['zh-CN-XiaoxiaoNeural'],
      generatedAt: '2026-11-18',
    });
    expect(checksums['hsk1:l01:dialogue'].voices).toEqual([
      'zh-CN-YunxiNeural',
      'zh-CN-XiaoxiaoNeural',
    ]);

    const second = await runTts(approved(), provider, options);
    expect(second.skipped).toHaveLength(2);
    expect(provider.calls).toHaveLength(2);

    writeFileSync(join(dir, 'hsk1_l01_w01.mp3'), 'tampered');
    const third = await runTts(approved(), provider, options);
    expect(third.generated).toEqual(['hsk1:l01:w01']);
  });

  it('azure provider posts SSML with the key header and maps errors without leaking the key', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const ok = azureProvider('secret-key', 'eastasia', ((
      url: string,
      init: RequestInit,
    ) => {
      seen.push({ url, init });
      return Promise.resolve(new Response(Buffer.from('ID3')));
    }) as unknown as typeof fetch);
    await expect(ok.synthesize('<speak/>')).resolves.toHaveLength(3);
    expect(seen[0].url).toBe(
      'https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1',
    );
    expect(
      (seen[0].init.headers as Record<string, string>)[
        'Ocp-Apim-Subscription-Key'
      ],
    ).toBe('secret-key');
    const failing = azureProvider('secret-key', 'eastasia', () =>
      Promise.resolve(new Response('no', { status: 401 })),
    );
    await expect(failing.synthesize('<speak/>')).rejects.toThrow(
      'Azure TTS trả 401',
    );
    await failing.synthesize('<speak/>').catch((error: Error) => {
      expect(error.message).not.toContain('secret-key');
    });
    expect(() => azureProvider('k', 'east asia')).toThrow(
      'AZURE_SPEECH_REGION',
    );
  });
});
