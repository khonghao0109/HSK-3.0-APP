'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Icon } from '@/components/ui/icon';

import {
  RECORD_LIMIT_MS,
  recordingClock,
  recordingSupported,
  useRecorder,
} from './recording';
import { SPEECH_RATE } from './speech';
import {
  loadWordStrokes,
  type StrokeCache,
  type WordStrokes,
} from './stroke-data';
import { WritingBoard } from './writing-board';

type Props = {
  /** What Nghe reads and Nói asks for: the word, or the example sentence. */
  hanzi: string;
  pinyin: string | null;
  length: keyof typeof RECORD_LIMIT_MS;
  /** The device has a zh voice (Nghe, Giọng mẫu). */
  voice: boolean;
  speak: (text: string, rate?: number) => void;
  onNext: () => void;
  /** Word cards only: stroke reads for the unit. Viết shows once every character has strokes. */
  strokeCache?: StrokeCache;
};

const noSubscribe = () => () => undefined;

const LIVE = {
  idle: '',
  recording: 'Đang ghi âm',
  recorded: 'Đã ghi xong. Bấm Bạn đọc để so với giọng mẫu.',
  denied: 'Chưa có quyền dùng micro',
} as const;

/**
 * Thanh đáy của thẻ từ và câu ví dụ (mẫu vu-card, vu-example): Nghe · Nói ·
 * Viết · Tiếp, với bảng ghi âm phía trên. Nói ẩn khi trình duyệt không ghi
 * được; Viết (G2d) chỉ có ở thẻ từ và khi mọi chữ có dữ liệu nét.
 */
export function PracticeBar({
  hanzi,
  pinyin,
  length,
  voice,
  speak,
  onNext,
  strokeCache,
}: Props) {
  const limit = RECORD_LIMIT_MS[length];
  const seconds = limit / 1000;
  const recorder = useRecorder(limit);
  // Server render: no Nói; the browser decides after hydration.
  const canRecord = useSyncExternalStore(
    noSubscribe,
    recordingSupported,
    () => false,
  );
  const audio = useRef<HTMLAudioElement | null>(null);
  const { state } = recorder;
  const [strokes, setStrokes] = useState<WordStrokes | null>(null);
  const [writing, setWriting] = useState(false);
  const writeButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!strokeCache) return;
    let live = true;
    void loadWordStrokes(strokeCache, hanzi).then((data) => {
      if (live) setStrokes(data);
    });
    return () => {
      live = false;
    };
  }, [strokeCache, hanzi]);

  const closeWriting = () => {
    setWriting(false);
    requestAnimationFrame(() => writeButton.current?.focus());
  };

  const toggle = () =>
    state === 'recording' ? recorder.stop() : void recorder.start();
  const playMine = () => {
    if (!recorder.url) return;
    audio.current?.pause();
    audio.current = new Audio(recorder.url);
    void audio.current.play();
  };

  return (
    <div className="g-dock">
      {state === 'recording' && (
        <div className="g-sheet">
          <p className="g-sheet__title">
            <span className="g-recdot" aria-hidden="true" />
            Đang ghi âm{' '}
            <span className="g-time">{recordingClock(recorder.elapsedMs)}</span>
            <span className="sr-only">{`, tối đa ${seconds} giây`}</span>
          </p>
          <div className="g-meter" aria-hidden="true">
            {Array.from({ length: 10 }, (_, at) => (
              <i key={at} />
            ))}
          </div>
          <p className="g-sheet__text">
            Đọc to <span lang="zh-Hans">{hanzi}</span>
            {pinyin ? ` (${pinyin})` : ''}. Tự dừng sau {seconds} giây.
          </p>
          <button
            className="g-btn g-btn--block"
            type="button"
            onClick={recorder.stop}
          >
            <Icon name="pause" />
            Dừng ghi
          </button>
        </div>
      )}
      {state === 'recorded' && (
        <div className="g-sheet">
          <p className="g-sheet__title">
            <Icon name="check-circle" />
            Đã ghi xong
          </p>
          <p className="g-sheet__text">
            Nghe giọng mẫu rồi nghe bạn đọc để tự so.
          </p>
          <div className="g-compare">
            {voice && (
              <button
                className="g-btn g-btn--ghost"
                type="button"
                onClick={() => speak(hanzi, SPEECH_RATE)}
              >
                <Icon name="volume" />
                Giọng mẫu
              </button>
            )}
            <button
              className="g-btn g-btn--ghost"
              type="button"
              onClick={playMine}
            >
              <Icon name="play" />
              Bạn đọc
            </button>
          </div>
          <button
            className="g-btn g-btn--ghost g-btn--block"
            type="button"
            onClick={() => void recorder.start()}
          >
            <Icon name="rotate-ccw" />
            Ghi lại
          </button>
          <p className="g-sheet__note">
            <Icon name="lock" />
            Bản ghi chỉ nằm trên máy này, không gửi đi và mất khi rời màn hình.
          </p>
        </div>
      )}
      {state === 'denied' && (
        <div className="g-sheet" role="alert">
          <p className="g-sheet__title">
            <Icon name="alert-triangle" />
            Chưa có quyền dùng micro
          </p>
          <p className="g-sheet__text">
            Bấm biểu tượng ổ khoá cạnh địa chỉ trang, cho phép Micro, rồi thử
            lại. Bạn vẫn học tiếp được mà không cần ghi âm.
          </p>
          <button
            className="g-btn g-btn--ghost g-btn--block"
            type="button"
            onClick={() => void recorder.start()}
          >
            <Icon name="refresh" />
            Thử lại
          </button>
        </div>
      )}

      <div className="g-bar" role="group" aria-label="Luyện từ này">
        {voice && (
          <button
            className="g-tool"
            type="button"
            onClick={() => speak(hanzi, SPEECH_RATE)}
          >
            <span className="g-tool__dot">
              <Icon name="volume" size={24} />
            </span>
            Nghe
          </button>
        )}
        {canRecord && (
          <button
            className="g-tool g-tool--main"
            type="button"
            aria-pressed={state === 'recording'}
            onClick={toggle}
          >
            <span className="g-tool__dot">
              <Icon name="mic" size={24} />
            </span>
            Nói
          </button>
        )}
        {strokes && (
          <button
            className="g-tool"
            type="button"
            ref={writeButton}
            aria-haspopup="dialog"
            onClick={() => setWriting(true)}
          >
            <span className="g-tool__dot">
              <Icon name="pencil" size={24} />
            </span>
            Viết
          </button>
        )}
        <button className="g-next" type="button" onClick={onNext}>
          <span className="g-next__dot">
            <Icon name="arrow-right" size={24} />
          </span>
          Tiếp
        </button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {LIVE[state]}
      </p>
      {writing && strokes && (
        <WritingBoard
          hanzi={hanzi}
          pinyin={pinyin}
          data={strokes}
          onClose={closeWriting}
        />
      )}
    </div>
  );
}
