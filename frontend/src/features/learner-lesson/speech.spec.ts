import { describe, expect, it } from 'vitest';

import { pickChineseVoice } from './speech';

type Voice = Pick<SpeechSynthesisVoice, 'lang' | 'localService' | 'name'>;

const voice = (lang: string, localService: boolean, name = lang): Voice => ({
  lang,
  localService,
  name,
});

describe('pickChineseVoice (Pha G2a)', () => {
  it('returns null when the device has no Chinese voice', () => {
    expect(pickChineseVoice([])).toBeNull();
    expect(
      pickChineseVoice([voice('en-US', true), voice('vi-VN', true)]),
    ).toBeNull();
  });

  it('prefers a local zh-CN voice over a remote one', () => {
    const remote = voice('zh-CN', false, 'Google 普通话');
    const local = voice('zh-CN', true, 'Tingting');
    expect(pickChineseVoice([remote, local])).toBe(local);
  });

  it('prefers zh-CN over another zh voice, and takes zh, zh_CN and zh-Hans', () => {
    const tw = voice('zh-TW', true);
    const cn = voice('zh_CN', false);
    expect(pickChineseVoice([tw, cn])).toBe(cn);
    const bare = voice('zh', true);
    expect(pickChineseVoice([voice('en-US', true), bare])).toBe(bare);
    const hans = voice('zh-Hans-CN', false);
    expect(pickChineseVoice([hans])).toBe(hans);
  });

  it('falls back to another zh voice, but never to a non-Chinese one', () => {
    const hk = voice('zh-HK', true);
    expect(pickChineseVoice([voice('ja-JP', true), hk])).toBe(hk);
    expect(pickChineseVoice([voice('zhx-XX', true)])).toBeNull();
  });
});
