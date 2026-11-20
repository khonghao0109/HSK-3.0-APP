import { useCallback, useEffect, useState } from 'react';

/**
 * Nghe bằng Web Speech (Pha G2a, PO 20/11/2026): giọng zh của máy, chỉ phát
 * khi người học bấm. Máy không có giọng zh thì không có nút Nghe.
 * Nguồn: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices
 * (danh sách có thể rỗng tới khi `voiceschanged` bắn) và
 * https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/rate
 */

export const SPEECH_RATE = 0.9;
export const SPEECH_RATE_SLOW = 0.6;

type VoiceLike = Pick<SpeechSynthesisVoice, 'lang' | 'localService'>;

const CHINESE = /^zh(?:[-_]|$)/i;
const MAINLAND = /^zh(?:[-_](?:cn|hans(?:[-_]cn)?))?$/i;

/**
 * The voice to read Chinese with: zh-CN (or zh, zh-Hans) before other zh
 * voices, a local voice before a network one; null when there is none.
 */
export function pickChineseVoice<T extends VoiceLike>(
  voices: readonly T[],
): T | null {
  const rank = (item: T) =>
    (MAINLAND.test(item.lang) ? 0 : 2) + (item.localService ? 0 : 1);
  let best: T | null = null;
  for (const item of voices) {
    if (!CHINESE.test(item.lang)) continue;
    if (best === null || rank(item) < rank(best)) best = item;
  }
  return best;
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null;
}

/**
 * The device's Chinese voice (null until one is known) and `speak`, which
 * stops what is playing and reads `text` at `rate`.
 */
export function useChineseVoice() {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    const speech = synth();
    if (!speech) return;
    const update = () => setVoice(pickChineseVoice(speech.getVoices()));
    update();
    speech.addEventListener('voiceschanged', update);
    return () => {
      speech.removeEventListener('voiceschanged', update);
      speech.cancel();
    };
  }, []);

  const speak = useCallback(
    (text: string, rate: number = SPEECH_RATE) => {
      const speech = synth();
      if (!speech || !voice) return;
      speech.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = rate;
      speech.speak(utterance);
    },
    [voice],
  );

  return { available: voice !== null, speak };
}
