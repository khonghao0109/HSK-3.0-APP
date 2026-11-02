'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import {
  formatClock,
  isBarPlayed,
  WAVE_BARS,
  WAVE_TRACK_WIDTH,
  type PlayerMedia,
} from './lesson-player-model';

export const LISTENING_MESSAGES = {
  play: 'Phát',
  pause: 'Tạm dừng',
  replay: 'Nghe lại',
  failed: 'Không tải được audio.',
} as const;

/** M2.5e: the two speeds the learner can pick (Q170, Q171). */
export type ListeningSpeed = '0.75' | '1';

const SPEED_RATE: Record<ListeningSpeed, number> = { '0.75': 0.75, '1': 1 };
const SPEED_LABEL: Record<ListeningSpeed, string> = {
  '0.75': '0,75×',
  '1': '1×',
};
const SPEED_OPTIONS: ReadonlyArray<ListeningSpeed> = ['0.75', '1'];

/** A grant this close to expiry is renewed before it is played. */
const GRANT_MARGIN_MS = 15_000;
const WAVE_HEIGHT = 24;

type Grant = { src: string; expiresAtMs: number };

async function requestGrant(mediaId: number): Promise<Grant | null> {
  try {
    const response = await fetch(`/api/learner/media/${mediaId}/access`);
    const body: unknown = await response.json().catch(() => null);
    if (response.status !== 200 || typeof body !== 'object' || body === null) {
      return null;
    }
    const data: unknown = Reflect.get(body, 'data');
    if (typeof data !== 'object' || data === null) return null;
    const src: unknown = Reflect.get(data, 'src');
    const expiresAt: unknown = Reflect.get(data, 'expiresAt');
    if (
      typeof src !== 'string' ||
      !src.startsWith(`/api/learner/media/${mediaId}/content?`) ||
      typeof expiresAt !== 'string'
    ) {
      return null;
    }
    const expiresAtMs = Date.parse(expiresAt);
    return Number.isFinite(expiresAtMs) ? { src, expiresAtMs } : null;
  } catch {
    return null;
  }
}

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/**
 * listening_choice (M2.5c, Q54–Q57; M2.5e, Q170–Q171): prompt, audio row, the
 * speed tools (group, live note, "Nghe lại"), then the options passed as
 * children. Nothing plays or downloads until the learner presses play (Q56);
 * only the access grant is fetched up front so play() still runs inside the
 * click (Safari). The speed itself is owned by the player so it survives the
 * per-question key (TL-201).
 */
export function ListeningExercise({
  prompt,
  media,
  headingRef,
  speed,
  onSpeedChange,
  children,
}: {
  prompt: string;
  media: PlayerMedia;
  headingRef: RefObject<HTMLHeadingElement | null>;
  speed: ListeningSpeed;
  onSpeedChange: (speed: ListeningSpeed) => void;
  children: ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  // The last grant received, read synchronously in the click handler.
  const grantRef = useRef<Grant | null>(null);
  const hasSrcRef = useRef(false);
  const retriedRef = useRef(false);
  // The speed as of the latest render/click: a grant that arrives later must
  // apply the learner's current choice, not the one from the render that
  // asked. The ref is also set synchronously in changeSpeed; this effect keeps
  // it in step when the player re-renders with a new prop (assigning a ref
  // during render is rejected by react-hooks/refs).
  const speedRef = useRef<ListeningSpeed>(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  // Bumped on pause and unmount: a grant that arrives later must not play.
  const generationRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  // A press while a grant request is in flight shares it instead of asking twice.
  const pendingRef = useRef<Promise<Grant | null> | null>(null);

  const fetchGrant = useCallback(() => {
    if (pendingRef.current) return pendingRef.current;
    const pending = requestGrant(media.id).then((grant) => {
      if (pendingRef.current === pending) pendingRef.current = null;
      if (grant) grantRef.current = grant;
      return grant;
    });
    pendingRef.current = pending;
    return pending;
  }, [media.id]);

  // Access only, no bytes: the audio element keeps preload="none".
  useEffect(() => {
    void fetchGrant();
    const audio = audioRef.current;
    return () => {
      generationRef.current += 1;
      hasSrcRef.current = false;
      pendingRef.current = null;
      if (!audio) return;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, [fetchGrant]);

  const showFailure = () => {
    setFailed(true);
    setPlaying(false);
  };

  const play = (audio: HTMLAudioElement) => {
    audio.play().catch((error: unknown) => {
      // A new src aborts the old play(); a media error arrives as `error`.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!audio.error) setPlaying(false);
    });
  };

  const playFrom = (audio: HTMLAudioElement, grant: Grant, at: number) => {
    // TL-200: a new `src` runs the media load algorithm, which resets
    // `playbackRate` to `defaultPlaybackRate`; assign both after the src.
    audio.src = grant.src;
    const rate = SPEED_RATE[speedRef.current];
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    hasSrcRef.current = true;
    if (at > 0) audio.currentTime = at;
    play(audio);
  };

  const start = (fromStart: boolean) => {
    const audio = audioRef.current;
    if (!audio) return;
    retriedRef.current = false;
    setFailed(false);
    setEnded(false);
    // After a failure the element keeps its error and play() would reject
    // at once with no new error event: start over from a grant.
    if (audio.error) hasSrcRef.current = false;
    if (hasSrcRef.current) {
      // Q171/TL-200: "Nghe lại" and a resumed play keep the chosen speed too
      // (no new src, so the media load algorithm does not run).
      audio.defaultPlaybackRate = SPEED_RATE[speedRef.current];
      audio.playbackRate = SPEED_RATE[speedRef.current];
      if (fromStart) audio.currentTime = 0;
      play(audio);
      return;
    }
    // A grant with time left plays inside the click itself.
    const grant = grantRef.current;
    if (grant && grant.expiresAtMs - Date.now() > GRANT_MARGIN_MS) {
      playFrom(audio, grant, 0);
      return;
    }
    const generation = generationRef.current;
    void fetchGrant().then((fresh) => {
      if (generation !== generationRef.current) return;
      if (fresh) playFrom(audio, fresh, 0);
      else showFailure();
    });
  };

  const changeSpeed = (value: ListeningSpeed) => {
    speedRef.current = value;
    onSpeedChange(value);
    // Q171: mid-playback the new rate applies at once, with no reload, no
    // play() and no seek; while idle it only changes the choice (Q56: no
    // bytes, no grant, no play until Phát).
    const audio = audioRef.current;
    if (audio) audio.playbackRate = SPEED_RATE[value];
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      generationRef.current += 1;
      audio.pause();
      return;
    }
    start(false);
  };

  const onError = () => {
    const audio = audioRef.current;
    if (!audio || !hasSrcRef.current) return;
    if (retriedRef.current) {
      showFailure();
      return;
    }
    // One retry with a fresh grant (it may have expired or been refused).
    retriedRef.current = true;
    const resumeAt = audio.currentTime;
    const generation = generationRef.current;
    void fetchGrant().then((grant) => {
      if (generation !== generationRef.current) return;
      if (grant) playFrom(audio, grant, resumeAt);
      else showFailure();
    });
  };

  const onMetadata = () => {
    const value = audioRef.current?.duration;
    if (value !== undefined && Number.isFinite(value) && value > 0) {
      setDuration(value);
    }
  };

  const total = duration ?? media.duration ?? 0;
  const shownTotal = Math.ceil(total);
  const played = ended ? 1 : total > 0 ? Math.min(1, current / total) : 0;

  return (
    <>
      <h2 className="pr-q" id="ex-q" ref={headingRef} tabIndex={-1}>
        {prompt}
      </h2>
      <div className="ls-audio">
        <button
          className="play-btn ls-play"
          type="button"
          aria-label={
            playing ? LISTENING_MESSAGES.pause : LISTENING_MESSAGES.play
          }
          aria-pressed={playing}
          onClick={togglePlay}
        >
          <Icon name={playing ? 'pause' : 'volume-fill'} />
        </button>
        <div className="ls-audio__track">
          <svg className="ls-wave" aria-hidden="true" focusable="false">
            {WAVE_BARS.map(([x, h]) => {
              const height = Math.round(h * 0.8966 * 10) / 10;
              return (
                <rect
                  key={x}
                  className={isBarPlayed(x, played) ? undefined : 'is-rest'}
                  x={`${((x / WAVE_TRACK_WIDTH) * 100).toFixed(2)}%`}
                  y={(WAVE_HEIGHT - height) / 2}
                  width={2}
                  height={height}
                  rx={1}
                />
              );
            })}
          </svg>
          <div className="ls-audio__time">
            <span>{formatClock(ended ? shownTotal : current)}</span>
            <span>{formatClock(shownTotal)}</span>
          </div>
        </div>
      </div>

      <div className="ls-tools">
        <div className="uxb-seg" role="group" aria-label="Tốc độ phát">
          {SPEED_OPTIONS.map((value) => (
            <button
              key={value}
              className={`uxb-seg__btn${speed === value ? ' is-on' : ''}`}
              type="button"
              aria-pressed={speed === value}
              onClick={() => changeSpeed(value)}
            >
              {SPEED_LABEL[value]}
            </button>
          ))}
        </div>
        <span className="ls-speed-note" aria-live="polite">
          {`Tốc độ ${SPEED_LABEL[speed]}`}
        </span>
        <button className="ls-tool" type="button" onClick={() => start(true)}>
          <Icon name="rotate-ccw" />
          <span>{LISTENING_MESSAGES.replay}</span>
        </button>
      </div>

      {failed && (
        <p className="ex-error" role="alert">
          {LISTENING_MESSAGES.failed}
        </p>
      )}

      {children}

      {/* No controls: the row above drives it. */}
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
        }}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={onMetadata}
        onDurationChange={onMetadata}
        onError={onError}
      />
    </>
  );
}
