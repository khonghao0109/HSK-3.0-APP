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
 * listening_choice (M2.5c, Q54–Q57): prompt, audio row, the options passed
 * as children, then "Nghe lại". Nothing plays or downloads until the learner
 * presses play (Q56); only the access grant is fetched up front so play()
 * still runs inside the click (Safari).
 */
export function ListeningExercise({
  prompt,
  media,
  headingRef,
  children,
}: {
  prompt: string;
  media: PlayerMedia;
  headingRef: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  // The last grant received, read synchronously in the click handler.
  const grantRef = useRef<Grant | null>(null);
  const hasSrcRef = useRef(false);
  const retriedRef = useRef(false);
  // Bumped on pause and unmount: a grant that arrives later must not play.
  const generationRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const fetchGrant = useCallback(async () => {
    const grant = await requestGrant(media.id);
    if (grant) grantRef.current = grant;
    return grant;
  }, [media.id]);

  // Access only, no bytes: the audio element keeps preload="none".
  useEffect(() => {
    void fetchGrant();
    const audio = audioRef.current;
    return () => {
      generationRef.current += 1;
      hasSrcRef.current = false;
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
    audio.src = grant.src;
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

      {children}

      <div className="ls-tools">
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
