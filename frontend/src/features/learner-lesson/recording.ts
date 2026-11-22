import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Nói (Pha G2b, PO 22/11/2026): ghi giọng người học rồi nghe lại, không chấm
 * (ADR-008). Bản ghi chỉ là Blob/object URL trong trang: không upload, không
 * localStorage/IndexedDB, revoke khi ghi lại hoặc rời màn. Micro chỉ xin khi
 * người học bấm Nói và nhả ngay khi dừng.
 * Nguồn: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
 * https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
 * https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static
 */

/** Q-G10: 5 s cho một từ, 10 s cho câu ví dụ. */
export const RECORD_LIMIT_MS = { word: 5000, sentence: 10_000 } as const;

const TICK_MS = 250;

/** The browser can record: getUserMedia and MediaRecorder both exist. */
export function recordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

/** Elapsed time as the mockup shows it: "0:03". */
export function recordingClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export type RecorderState = 'idle' | 'recording' | 'recorded' | 'denied';

/**
 * One recording at a time, stopped by itself at `limitMs`. `url` is the last
 * take; a new take or unmounting revokes it.
 */
export function useRecorder(limitMs: number) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const live = useRef(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const take = useRef<string | null>(null);

  const release = useCallback(() => {
    if (ticker.current !== null) clearInterval(ticker.current);
    ticker.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  const forget = useCallback(() => {
    if (take.current) URL.revokeObjectURL(take.current);
    take.current = null;
  }, []);

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorder.current?.state === 'recording') return;
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (live.current) setState('denied');
      return;
    }
    if (!live.current) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    forget();
    setUrl(null);
    stream.current = media;
    const chunks: Blob[] = [];
    const next = new MediaRecorder(media);
    recorder.current = next;
    next.ondataavailable = (event) => chunks.push(event.data);
    next.onstop = () => {
      release();
      if (!live.current) return;
      take.current = URL.createObjectURL(
        new Blob(chunks, { type: next.mimeType }),
      );
      setUrl(take.current);
      setState('recorded');
    };
    next.start();
    setElapsedMs(0);
    setState('recording');
    const began = Date.now();
    ticker.current = setInterval(() => {
      const ms = Date.now() - began;
      setElapsedMs(ms);
      if (ms >= limitMs) next.stop();
    }, TICK_MS);
  }, [forget, limitMs, release]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      release();
      forget();
    };
  }, [forget, release]);

  return { state, elapsedMs, url, start, stop };
}
