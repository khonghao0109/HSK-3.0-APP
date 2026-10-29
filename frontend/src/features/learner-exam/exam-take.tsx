'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useRadioGroup } from '@/features/onboarding/use-radio-group';
import {
  ArrangeSentence,
  ChoiceText,
  FillBlank,
} from '@/features/learner-lesson/lesson-player';
import {
  WAVE_BARS,
  hasHan,
  isBarPlayed,
} from '@/features/learner-lesson/lesson-player-model';
import { useLearnerToast } from '@/features/learner-shell/learner-toast';
import { TOAST_COMING_SOON } from '@/features/learner-shell/learner-toast-messages';

import {
  EXAM_QUEUE_DEBOUNCE_MS,
  createExamSaveQueue,
  type ExamQueueEvents,
} from './exam-save-queue';
import { createExamTransport } from './exam-take-transport';
import {
  EXAM_CLOSED_MESSAGE,
  EXAM_EXPIRED_MESSAGE,
  EXAM_LOW_NOTICE,
  EXAM_UNSAVED_BEFORE_EXPIRY,
  createExamTimer,
  formatTimer,
  lockMessage,
  timerLabel,
} from './exam-timer';
import {
  buildFillBlankAnswer,
  flattenQuestions,
  isSupportedType,
  questionIndexFor,
  questionKicker,
  questionPrompt,
  tokenCount,
  unsupportedTypeMessage,
  type ExamAnswer,
  type ExamAttemptView,
  type FlatQuestion,
} from './exam-take-model';

const SAVE_SAVED = 'Đã lưu';
const SAVE_SAVING = 'Đang lưu…';
const SAVE_PENDING = 'Chưa lưu';
const OFFLINE_TEXT =
  'Không kết nối được máy chủ. Kiểm tra kết nối mạng rồi thử lại.';
const OFFLINE_TAIL = 'Bài làm sẽ được lưu khi có mạng lại.';
const QUIT_TITLE = 'Thoát bài thi?';
const QUIT_BODY =
  'Đồng hồ vẫn chạy khi bạn thoát. Bài làm đã được lưu, bạn có thể quay lại làm tiếp trước khi hết giờ.';

type AnswerState = {
  answer: ExamAnswer;
  isFlagged: boolean;
  version: number | null;
  saving: 'idle' | 'saving' | 'error';
};

type Grants = {
  byMedia: Map<number, string>;
  /** M4.2b: signed URL expiry per media, epoch ms. */
  expiresAt: Map<number, number>;
  unavailable: Set<number>;
};

/** Refetch grants before a media whose signed URL expires within this window. */
const GRANT_REFRESH_WINDOW_MS = 15_000;

function grantExpiresSoon(
  expiresAt: number | undefined,
  nowMs: number,
): boolean {
  return expiresAt !== undefined && expiresAt - nowMs < GRANT_REFRESH_WINDOW_MS;
}

/* Mockup player shows two-digit minutes (`00:12 / 00:18`). */
function formatClockMM(seconds: number): string {
  const total =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function ExamTake({ attempt }: { attempt: ExamAttemptView }) {
  const router = useRouter();
  const showToast = useLearnerToast();
  const flat = useMemo(() => flattenQuestions(attempt), [attempt]);
  const initialIndex = useMemo(
    () => questionIndexFor(flat, attempt.answers),
    [flat, attempt.answers],
  );

  const [index, setIndex] = useState(initialIndex);
  const [answers, setAnswers] = useState<Map<string, AnswerState>>(() => {
    const map = new Map<string, AnswerState>();
    for (const row of attempt.answers) {
      map.set(row.questionKey, {
        answer: row.answer,
        isFlagged: row.isFlagged,
        version: row.version,
        saving: 'idle',
      });
    }
    return map;
  });
  const [remaining, setRemaining] = useState(attempt.remainingSeconds);
  const [lowNotice, setLowNotice] = useState(false);
  const [locked, setLocked] = useState(
    attempt.status !== 'in_progress' || attempt.remainingSeconds === 0,
  );
  const [lockText, setLockText] = useState(
    attempt.status !== 'in_progress' ? lockMessage(attempt.status) : '',
  );
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const [fillError, setFillError] = useState<string | null>(null);
  const [grantsLoaded, setGrantsLoaded] = useState(false);
  const [grants, setGrants] = useState<Grants>({
    byMedia: new Map(),
    expiresAt: new Map(),
    unavailable: new Set(),
  });
  const [listeningKey, setListeningKey] = useState<string | null>(null);
  const [playedKeys, setPlayedKeys] = useState<Set<string>>(new Set());
  const [speed, setSpeed] = useState<'0.75' | '1'>('1');
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playError, setPlayError] = useState<string | null>(null);
  const [dialogKind, setDialogKind] = useState<'quit' | null>(null);

  const queueRef = useRef<ReturnType<typeof createExamSaveQueue> | null>(null);
  const timerRef = useRef<ReturnType<typeof createExamTimer> | null>(null);
  const [orderDrafts, setOrderDrafts] = useState<Map<string, string[]>>(
    () => new Map(),
  );
  const [fillDrafts, setFillDrafts] = useState<Map<string, string>>(
    () => new Map(),
  );
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const quitButtonRef = useRef<HTMLButtonElement | null>(null);
  const quitTriggerRef = useRef<HTMLButtonElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listeningKeyRef = useRef<string | null>(null);
  const attemptedAfterLock = useRef(false);
  const pendingRef = useRef(0);
  const lockedRef = useRef(locked);
  const currentKeyRef = useRef<string | null>(null);
  const grantsRef = useRef(grants);
  const grantsLoaderRef = useRef<
    (() => Promise<Map<number, string> | null>) | null
  >(null);
  const mediaRetryRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => {
    grantsRef.current = grants;
  });

  const current = flat[index];
  // Layout effect: the ref must be fresh at commit, before any async grants
  // continuation can observe it.
  useLayoutEffect(() => {
    currentKeyRef.current = current?.question.key ?? null;
  }, [current]);

  const currentMediaId = useMemo(() => {
    if (current === undefined) return null;
    const audio = current.question.audio ?? current.group.audio;
    const image = current.question.image ?? current.group.image;
    return audio?.mediaId ?? image?.mediaId ?? null;
  }, [current]);

  const setAnswerState = useCallback(
    (questionKey: string, update: Partial<AnswerState>) => {
      setAnswers((previous) => {
        const next = new Map(previous);
        const existing = next.get(questionKey) ?? {
          answer: null,
          isFlagged: false,
          version: null,
          saving: 'idle' as const,
        };
        next.set(questionKey, { ...existing, ...update });
        return next;
      });
    },
    [],
  );

  const lockExam = useCallback(
    (status: 'expired' | 'closed', message?: string) => {
      // G1 (2c): chốt ngay trong ref (effect cập nhật ref chạy sau render) để
      // mọi lần gọi lại media-grants đang chờ dừng trước cả khi re-render.
      lockedRef.current = true;
      // Keep the first lock message: a later 409 must not replace the reason
      // already shown to the learner.
      setLockText((current) =>
        current.length > 0 ? current : (message ?? lockMessage(status)),
      );
      setLocked(true);
      setDialogKind(null);
      dialogRef.current?.close();
      // F11: skip the backoff so the last edits can still land in the 5 s grace.
      void queueRef.current?.retryNow();
    },
    [],
  );

  /**
   * M4.2b: the queue must survive a re-render. It owns in-memory versions and
   * unknown-outcome bodies, so recreating it silently downgrades the next
   * expectedVersion. The effect below depends on `attempt.id` only; every
   * callback it uses is read from this ref, refreshed on each render.
   */
  const initialRows = attempt.answers.map((row) => ({
    questionKey: row.questionKey,
    answer: row.answer,
    isFlagged: row.isFlagged,
    version: row.version,
  }));
  const callbacksRef = useRef({
    flat,
    initialRows,
    lockExam,
    router,
    setAnswerState,
    showToast,
  });
  useEffect(() => {
    Object.assign(callbacksRef.current, {
      flat,
      initialRows,
      lockExam,
      router,
      setAnswerState,
      showToast,
    });
  });

  useEffect(() => {
    const events: ExamQueueEvents = {
      onSaving: ({ saving: isSaving, pending }) => {
        setSaving(isSaving);
        setPendingCount(pending);
        pendingRef.current = pending;
      },
      onSaved: (questionKey) => {
        callbacksRef.current.setAnswerState(questionKey, { saving: 'idle' });
        setFailedKeys((previous) => {
          if (!previous.has(questionKey)) return previous;
          const next = new Set(previous);
          next.delete(questionKey);
          return next;
        });
      },
      onServerAnswer: (questionKey, answer, isFlagged, version) => {
        // D13: a row for a question that still has local work must not replace
        // what the learner is typing/arranging, nor drop the draft.
        if (queueRef.current?.hasLocalWork(questionKey) === true) return;
        setFillDrafts((previous) => {
          if (!previous.has(questionKey)) return previous;
          const next = new Map(previous);
          next.delete(questionKey);
          return next;
        });
        setOrderDrafts((previous) => {
          if (!previous.has(questionKey)) return previous;
          const next = new Map(previous);
          next.delete(questionKey);
          return next;
        });
        callbacksRef.current.setAnswerState(questionKey, {
          answer,
          isFlagged,
          version,
          saving: 'idle',
        });
      },
      onConflictToast: (questionKey) => {
        // E3: the server row wins; drop any local draft for that question.
        setFillDrafts((previous) => {
          if (!previous.has(questionKey)) return previous;
          const next = new Map(previous);
          next.delete(questionKey);
          return next;
        });
        setOrderDrafts((previous) => {
          if (!previous.has(questionKey)) return previous;
          const next = new Map(previous);
          next.delete(questionKey);
          return next;
        });
        const entry = callbacksRef.current.flat.find(
          (item) => item.question.key === questionKey,
        );
        callbacksRef.current.showToast(
          `Câu ${String(entry?.number ?? 1)} vừa được lưu ở phiên khác. Đã tải bản mới nhất.`,
          'status',
        );
      },
      onInvalid: (questionKey, code) => {
        callbacksRef.current.setAnswerState(questionKey, { saving: 'error' });
        setFailedKeys((previous) => new Set(previous).add(questionKey));
        // One line only, as TL-136 requires; never the answer content.
        console.error('[exam-autosave]', questionKey, code);
      },
      onLocked: (status, unsavedKeys) => {
        if ((unsavedKeys ?? []).length > 0) {
          setFailedKeys((previous) => {
            const next = new Set(previous);
            for (const key of unsavedKeys ?? []) next.add(key);
            return next;
          });
        }
        callbacksRef.current.lockExam(status);
      },
      onAuthLost: () => callbacksRef.current.router.replace('/sign-in'),
      onNotFound: () => callbacksRef.current.router.refresh(),
      onRemainingSeconds: (seconds) => {
        setRemaining(seconds);
        timerRef.current?.rebase(seconds);
        if (seconds === 0) callbacksRef.current.lockExam('expired');
      },
      onOffline: (isOffline) => setOffline(isOffline),
    };
    queueRef.current = createExamSaveQueue({
      transport: createExamTransport(attempt.id),
      initialRows: callbacksRef.current.initialRows,
      events,
      deps: {
        randomUUID: () => crypto.randomUUID(),
        setTimeout: (handler, ms) => window.setTimeout(handler, ms),
        clearTimeout: (handle) => {
          window.clearTimeout(handle as number);
        },
        isOnline: () => navigator.onLine,
        now: () => performance.now(),
      },
    });
    return () => {
      const queue = queueRef.current;
      queueRef.current = null;
      if (queue === null) return;
      // Flush first so a debounced edit already accepted by the queue is not
      // dropped when the island unmounts; dispose only after that final flush
      // settles, otherwise `disposed` would cancel the pending drain.
      void queue.flush({ force: true }).finally(() => {
        queue.dispose();
      });
    };
  }, [attempt.id]);

  useEffect(() => {
    const timer = createExamTimer({
      remainingSeconds: attempt.remainingSeconds,
      deps: {
        now: () => performance.now(),
        setInterval: (handler, ms) => window.setInterval(handler, ms),
        clearInterval: (handle) => window.clearInterval(handle),
      },
      onTick: (state) => setRemaining(state.remainingSeconds),
      onZero: () => {
        lockExam('expired');
      },
    });
    timerRef.current = timer;
    timer.start();
    return () => {
      timer.stop();
      timerRef.current = null;
    };
  }, [attempt.remainingSeconds, lockExam]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (lowNotice) return;
      if (remaining > 0 && remaining < 300) setLowNotice(true);
    }, 500);
    return () => window.clearInterval(interval);
  }, [remaining, lowNotice]);

  useEffect(() => {
    if (!locked) return;
    void queueRef.current?.flush();
    if (attemptedAfterLock.current) return;
    attemptedAfterLock.current = true;
    const timer = window.setTimeout(() => {
      void fetch(`/api/learner/exam/attempts/${attempt.id}`).catch(() => null);
    }, 6_000);
    return () => window.clearTimeout(timer);
  }, [attempt.id, locked]);

  useEffect(() => {
    const entries = callbacksRef.current.flat;
    const hasMedia = entries.some((entry) => {
      const audio = entry.question.audio ?? entry.group.audio;
      const image = entry.question.image ?? entry.group.image;
      return audio !== null || image !== null;
    });
    if (!hasMedia) return;
    let cancelled = false;
    const load = async (): Promise<Map<number, string> | null> => {
      // G1 (2c): bài đã khoá (mount hoặc giữa phiên) thì không gọi grant —
      // loader là đường duy nhất cho cả lần đầu lẫn retry.
      if (lockedRef.current) return null;
      try {
        const response = await fetch(
          `/api/learner/exam/attempts/${attempt.id}/media-grants`,
        );
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            callbacksRef.current.router.replace('/sign-in');
            return null;
          }
          if (response.status === 409) {
            const payload = (await response.json().catch(() => null)) as {
              error?: { code?: string };
            } | null;
            callbacksRef.current.lockExam(
              payload?.error?.code === 'EXAM_ATTEMPT_CLOSED'
                ? 'closed'
                : 'expired',
            );
            return null;
          }
          // C2: a failed grant fetch must not leave the play button silently
          // disabled forever; mark every media of this attempt unavailable.
          const unavailable = new Set<number>();
          for (const entry of entries) {
            if (entry.question.audio)
              unavailable.add(entry.question.audio.mediaId);
            if (entry.group.audio) unavailable.add(entry.group.audio.mediaId);
            if (entry.question.image)
              unavailable.add(entry.question.image.mediaId);
            if (entry.group.image) unavailable.add(entry.group.image.mediaId);
          }
          setGrants({
            byMedia: new Map(),
            expiresAt: new Map(),
            unavailable,
          });
          setGrantsLoaded(true);
          return null;
        }
        const payload = (await response.json().catch(() => null)) as {
          data?: {
            grants?: Array<{
              mediaId: number;
              src: string;
              expiresAt?: string;
            }>;
            unavailable?: number[];
          };
        } | null;
        if (cancelled) return null;
        const byMedia = new Map<number, string>();
        const expiresAt = new Map<number, number>();
        for (const grant of payload?.data?.grants ?? []) {
          byMedia.set(grant.mediaId, grant.src);
          const parsed =
            typeof grant.expiresAt === 'string'
              ? Date.parse(grant.expiresAt)
              : Number.NaN;
          if (Number.isFinite(parsed)) expiresAt.set(grant.mediaId, parsed);
        }
        setGrants({
          byMedia,
          expiresAt,
          unavailable: new Set(payload?.data?.unavailable ?? []),
        });
        setGrantsLoaded(true);
        return byMedia;
      } catch {
        if (!cancelled) {
          setOffline(true);
          setGrantsLoaded(true);
        }
        return null;
      }
    };
    grantsLoaderRef.current = load;
    void load();
    return () => {
      cancelled = true;
      grantsLoaderRef.current = null;
    };
  }, [attempt.id]);

  useEffect(() => {
    if (currentMediaId === null) return;
    const expiresAt = grantsRef.current.expiresAt.get(currentMediaId);
    if (!grantExpiresSoon(expiresAt, Date.now())) return;
    void grantsLoaderRef.current?.();
  }, [currentMediaId]);

  useEffect(() => {
    const onOnline = () => {
      const queue = queueRef.current;
      if (queue === null) return;
      // Only clear the banner when nothing needs saving; otherwise it stays
      // until the queue reports a successful save (`onOffline(false)`).
      if (!queue.hasPending()) setOffline(false);
      void queue.retryNow();
    };
    const onOffline = () => setOffline(true);
    const onVisibility = () => {
      // E2: leaving (tab switch/close) is a last flush and must ignore
      // backoff; returning only drains what is already runnable.
      void queueRef.current?.flush({
        force: document.visibilityState === 'hidden',
      });
    };
    const onPageHide = () => {
      void queueRef.current?.flush({ force: true });
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pendingRef.current === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (dialogKind === 'quit') {
      const dialog = dialogRef.current;
      if (dialog && !dialog.open) dialog.showModal();
      dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [dialogKind]);

  const currentState = current
    ? (answers.get(current.question.key) ?? {
        answer: null,
        isFlagged: false,
        version: null,
        saving: 'idle' as const,
      })
    : null;

  const answeredCount = flat.filter(
    (entry) => (answers.get(entry.question.key)?.answer ?? null) !== null,
  ).length;

  const save = useCallback(
    (
      entry: FlatQuestion,
      answer: ExamAnswer,
      isFlagged: boolean,
      debounce = false,
    ) => {
      if (lockedRef.current) return;
      setAnswerState(entry.question.key, {
        answer,
        isFlagged,
        saving: 'saving',
      });
      queueRef.current?.setAnswer(
        entry.question.key,
        { answer, isFlagged },
        { debounceMs: debounce ? EXAM_QUEUE_DEBOUNCE_MS : 0 },
      );
    },
    [setAnswerState],
  );

  const flushPending = useCallback(async (force = false) => {
    await queueRef.current?.flush(force ? { force: true } : undefined);
  }, []);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= flat.length) return;
      // F13: leaving a playing question stops it and counts it as heard.
      const playingKey = listeningKeyRef.current;
      if (playingKey !== null) {
        audioRef.current?.pause();
        setPlayedKeys((previous) => new Set(previous).add(playingKey));
        setListeningKey(null);
        listeningKeyRef.current = null;
      }
      setAudioProgress(0);
      setAudioDuration(0);
      setPlayError(null);
      if (current) {
        const state = answers.get(current.question.key);
        if (state) {
          void queueRef.current?.flush();
        }
      }
      setIndex(next);
      setPanelOpen(false);
      window.requestAnimationFrame(() => {
        document.getElementById('q-part')?.focus();
      });
    },
    [answers, current, flat.length],
  );

  const onSelect = (entry: FlatQuestion, answer: ExamAnswer) => {
    const state = answers.get(entry.question.key);
    save(entry, answer, state?.isFlagged ?? false);
  };

  const toggleFlag = () => {
    if (!current || locked) return;
    const state = answers.get(current.question.key);
    const answer = state?.answer ?? null;
    const next = !(state?.isFlagged ?? false);
    save(current, answer, next);
    showToast(
      next
        ? `Đã đánh dấu câu ${String(current.number)}`
        : `Đã bỏ đánh dấu câu ${String(current.number)}`,
      'status',
    );
  };

  const submitNotReady = () => showToast(TOAST_COMING_SOON, 'status');

  const quit = async () => {
    // F14: leave after at most 3 s even if the flush is still in flight.
    await Promise.race([
      flushPending(true),
      new Promise<void>((resolve) => window.setTimeout(resolve, 3_000)),
    ]);
    router.push(`/learn/exam/${String(attempt.testId)}`);
  };

  const closeQuit = () => {
    dialogRef.current?.close();
    setDialogKind(null);
    quitTriggerRef.current?.focus();
  };

  const openQuit = () => {
    if (locked) {
      router.push(`/learn/exam/${String(attempt.testId)}`);
      return;
    }
    setDialogKind('quit');
  };

  if (current === undefined || currentState === null) {
    return (
      <div className="ex ext">
        <main className="ext-main">
          <p>Không có câu hỏi trong bài thi này.</p>
        </main>
      </div>
    );
  }

  const audio = current.question.audio ?? current.group.audio;
  const image = current.question.image ?? current.group.image;
  const audioSrc = audio ? grants.byMedia.get(audio.mediaId) : undefined;
  const imageSrc = image ? grants.byMedia.get(image.mediaId) : undefined;
  const audioUnavailable = audio
    ? grantsLoaded &&
      (grants.unavailable.has(audio.mediaId) || audioSrc === undefined)
    : false;
  const isPlaying = listeningKey === current.question.key;
  const hasPlayed = playedKeys.has(current.question.key);
  // F25: the wave fills by real progress / duration, by each bar's x position.
  const playedFraction =
    audioDuration > 0 ? Math.min(1, audioProgress / audioDuration) : 0;

  const grantExpiringSoon = (mediaId: number): boolean =>
    grantExpiresSoon(grantsRef.current.expiresAt.get(mediaId), Date.now());

  const startAudio = () => {
    if (locked || audioUnavailable || isPlaying || hasPlayed) return;
    const element = audioRef.current;
    if (!element || !audioSrc) return;
    const play = (src?: string) => {
      const target = audioRef.current;
      if (!target) return;
      // Use the URL returned by the refresh directly: React has not necessarily
      // committed the new `src` prop when this callback runs.
      if (src !== undefined) target.src = src;
      target.playbackRate = speed === '0.75' ? 0.75 : 1;
      listeningKeyRef.current = current.question.key;
      setListeningKey(current.question.key);
      void target.play().catch(() => {
        setPlayError('Không tải được âm thanh.');
        listeningKeyRef.current = null;
        setListeningKey(null);
      });
    };
    // The signed URL is about to expire: refresh it before handing the source
    // to the browser, otherwise playback starts on a dead URL.
    if (audio !== null && grantExpiringSoon(audio.mediaId)) {
      const loader = grantsLoaderRef.current;
      if (loader !== null) {
        const mediaId = audio.mediaId;
        void loader().then((fresh) => {
          play(fresh?.get(mediaId));
        });
        return;
      }
    }
    play();
  };

  const onMediaError = (mediaId: number, kind: 'audio' | 'image') => {
    const questionKey = current.question.key;
    // Q123: read the listening key *before* resetting it. A load error before
    // the learner pressed play must not start playback or open a turn.
    const wasListening = listeningKeyRef.current === questionKey;
    if (kind === 'audio') {
      setPlayError('Không tải được âm thanh.');
      listeningKeyRef.current = null;
      setListeningKey(null);
    }
    // One retry per media: refetch the signed URLs, then replay only if the
    // learner was listening to this question when the error happened.
    if (mediaRetryRef.current.has(mediaId)) return;
    mediaRetryRef.current.add(mediaId);
    const loader = grantsLoaderRef.current;
    if (loader === null) return;
    void loader().then((fresh) => {
      if (kind !== 'audio') return;
      // The learner may have moved on while grants were loading: never touch
      // the new question's audio element.
      if (currentKeyRef.current !== questionKey) return;
      const target = audioRef.current;
      if (!target) return;
      const src = fresh?.get(mediaId);
      if (src !== undefined) target.src = src;
      if (!wasListening) {
        // The URL is usable again: do not leave the old load error on screen.
        setPlayError(null);
        return;
      }
      // The replay continues the same listening turn: no extra permission and
      // no extra "heard" mark (only `ended` adds the key, once).
      listeningKeyRef.current = questionKey;
      setListeningKey(questionKey);
      void target.play().catch(() => {
        setPlayError('Không tải được âm thanh.');
        listeningKeyRef.current = null;
        setListeningKey(null);
      });
    });
  };

  const speedButtons = audio ? (
    <div
      className="uxb-seg tk-speed"
      role="group"
      aria-label="Tốc độ phát phần nghe"
    >
      {(['0.75', '1'] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={`uxb-seg__btn${speed === value ? ' is-on' : ''}`}
          aria-pressed={speed === value}
          aria-disabled={hasPlayed || locked ? 'true' : undefined}
          onClick={() => {
            if (hasPlayed || locked) return;
            setSpeed(value);
          }}
        >
          {value === '0.75' ? '0,75×' : '1×'}
        </button>
      ))}
    </div>
  ) : null;
  const speedBlock = audio ? (
    <div className="ext-speed">
      {speedButtons}
      <span className="uxb-note" aria-live="polite">
        {`Tốc độ ${speed === '0.75' ? '0,75×' : '1×'}`}
      </span>
    </div>
  ) : null;

  const answerBlock = (() => {
    const question = current.question;
    if (!isSupportedType(question.type)) {
      return <p className="ext-note">{unsupportedTypeMessage()}</p>;
    }
    if (question.type === 'mcq' || question.type === 'true_false') {
      const options =
        question.type === 'true_false'
          ? [
              { id: 'true', text: 'Đúng' },
              { id: 'false', text: 'Sai' },
            ]
          : (question.answers.options ?? []);
      const selected =
        currentState.answer !== null && 'choice' in currentState.answer
          ? currentState.answer.choice
          : currentState.answer !== null && 'value' in currentState.answer
            ? String(currentState.answer.value)
            : null;
      return (
        <ChoiceGroup
          options={options}
          selected={selected}
          labelledBy="q-ask"
          disabled={locked}
          onSelect={(id) => {
            if (locked) return;
            onSelect(
              current,
              question.type === 'true_false'
                ? { value: id === 'true' }
                : { choice: id },
            );
          }}
        />
      );
    }
    if (question.type === 'fill_blank') {
      const serverText =
        currentState.answer !== null && 'text' in currentState.answer
          ? currentState.answer.text
          : '';
      // F9: the raw draft keeps spaces while typing; the server echo never
      // overwrites a question that still has local work.
      const draft = fillDrafts.get(question.key);
      const value = draft ?? serverText;
      return (
        <>
          <FillBlank
            prompt={question.content}
            text={value}
            locked={locked}
            headingRef={{ current: null }}
            maxLength={200}
            onChange={(raw) => {
              setFillError(null);
              setFillDrafts((previous) => {
                const next = new Map(previous);
                next.set(question.key, raw);
                return next;
              });
              const built = buildFillBlankAnswer(raw);
              if (built.action === 'error') {
                setFillError(built.message);
                return;
              }
              if (built.action === 'send') {
                save(current, built.answer, currentState.isFlagged, true);
                return;
              }
              if (queueRef.current?.questionVersion(question.key) != null) {
                save(current, null, currentState.isFlagged);
              }
            }}
            onBlur={() => {
              void flushPending();
            }}
            onKeyDown={() => undefined}
          />
          {fillError ? (
            <p className="ext-error" role="alert">
              {fillError}
            </p>
          ) : null}
        </>
      );
    }
    const serverOrder =
      currentState.answer !== null && 'order' in currentState.answer
        ? currentState.answer.order
        : [];
    // F8: a per-question draft keeps a half-built sentence on screen; the
    // queue only sees `{order}` once it holds every token.
    const order = orderDrafts.get(question.key) ?? serverOrder;
    const setDraft = (next: string[]) => {
      setOrderDrafts((previous) => {
        const map = new Map(previous);
        map.set(question.key, next);
        return map;
      });
    };
    return (
      <ArrangeSentence
        prompt={question.content}
        tokens={question.answers.tokens ?? []}
        tokenIds={order}
        locked={locked}
        result={null}
        headingRef={{ current: null }}
        onAdd={(id) => {
          if (locked || order.includes(id)) return;
          const next = [...order, id];
          setDraft(next);
          if (next.length === tokenCount(question)) {
            save(current, { order: next }, currentState.isFlagged);
          }
        }}
        onRemove={(id) => {
          if (locked) return;
          const next = order.filter((token) => token !== id);
          setDraft(next);
          if (
            next.length < tokenCount(question) &&
            currentState.answer !== null
          ) {
            save(current, null, currentState.isFlagged);
          }
        }}
      />
    );
  })();

  const showSavedCheck =
    !locked && !saving && pendingCount === 0 && failedKeys.size === 0;
  const saveLabel = locked
    ? ''
    : saving
      ? SAVE_SAVING
      : showSavedCheck
        ? SAVE_SAVED
        : SAVE_PENDING;

  return (
    <div className="ex ext">
      <header className="ex-bar ext-bar">
        {/* 2b-6 V3: nền navy chỉ thuộc hàng X+title (58px theo m04). */}
        <div className="ext-bar__row">
          <button
            type="button"
            className="icon-btn"
            aria-label="Thoát bài thi"
            ref={quitTriggerRef}
            onClick={openQuit}
          >
            <svg className="icon" aria-hidden="true">
              <use href="#i-x" />
            </svg>
          </button>
          <div className="ext-bar__main">
            <h1 className="ext-bar__title">{attempt.test.title}</h1>
            <progress
              className="ext-progress"
              aria-label="Tiến độ bài thi"
              value={answeredCount}
              max={Math.max(1, flat.length)}
            />
          </div>
        </div>
        <div className="ext-status">
          <p
            className={`ext-timer${remaining < 300 ? ' is-low' : ''}`}
            role="timer"
            aria-live="off"
            aria-label={timerLabel(remaining)}
          >
            <svg className="icon icon--sm" aria-hidden="true">
              <use href="#i-stopwatch" />
            </svg>
            <span className="tabular" aria-hidden="true">
              {formatTimer(remaining)}
            </span>
          </p>
          <p className="ext-count" aria-hidden="true">
            Câu {current.number}/{flat.length}
          </p>
          <button
            className="ext-count-btn"
            type="button"
            aria-expanded={panelOpen}
            aria-controls="exam-panel"
            aria-label={`Câu ${String(current.number)} trên ${String(flat.length)}. Mở danh sách câu hỏi`}
            onClick={() => setPanelOpen((open) => !open)}
          >
            <span aria-hidden="true">
              {current.number}/{flat.length}
            </span>
            <svg className="icon icon--sm" aria-hidden="true">
              <use href="#i-chevron-down" />
            </svg>
          </button>
          <p
            className={`ext-saved${
              saving ? ' is-saving' : showSavedCheck ? '' : ' is-unsaved'
            }`}
            role="status"
          >
            {showSavedCheck ? (
              <>
                <svg
                  className="icon icon--sm"
                  aria-hidden="true"
                  data-testid="exam-saved-check"
                >
                  <use href="#i-check-circle-line" />
                </svg>
                {SAVE_SAVED}
              </>
            ) : (
              <>
                {!saving && saveLabel !== '' ? (
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-x-circle" />
                  </svg>
                ) : null}
                {saveLabel}
              </>
            )}
          </p>
        </div>
      </header>

      <main className="ext-main">
        <p className="sr-only" aria-live="polite">
          {lowNotice ? EXAM_LOW_NOTICE : ''}
        </p>
        <p className="sr-only" aria-live="polite" data-testid="exam-count-live">
          {`Câu ${String(current.number)} trên ${String(flat.length)}`}
        </p>

        {offline && !locked ? (
          <div className="ext-offline" role="status">
            <svg className="icon" aria-hidden="true">
              <use href="#i-wifi-off" />
            </svg>
            <p>
              {OFFLINE_TEXT} {OFFLINE_TAIL}
            </p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                void queueRef.current?.retryNow();
              }}
            >
              <svg className="icon" aria-hidden="true">
                <use href="#i-rotate-ccw" />
              </svg>
              Thử lại
            </button>
          </div>
        ) : null}

        {locked ? (
          <div className="ext-locked" role="alert">
            <p>
              {lockText ||
                (remaining === 0 ? EXAM_EXPIRED_MESSAGE : EXAM_CLOSED_MESSAGE)}
            </p>
            {failedKeys.size > 0 || pendingCount > 0 ? (
              <p>{EXAM_UNSAVED_BEFORE_EXPIRY}</p>
            ) : null}
          </div>
        ) : null}

        <div className="ext-body">
          <section className="ext-question" aria-labelledby="q-part">
            <div className="ext-card">
              <h2 className="uxb-part tk-part" id="q-part" tabIndex={-1}>
                {questionKicker(current)}
              </h2>
              <div className="ext-qhead">
                <p className="uxb-qask tk-qask" id="q-ask">
                  {questionPrompt(current)}
                </p>
                <p className="ext-live" aria-live="polite">
                  {isPlaying || hasPlayed ? (
                    <>
                      <svg className="icon" aria-hidden="true">
                        <use href="#i-volume" />
                      </svg>
                      {isPlaying ? 'Đang phát' : 'Đã nghe'}
                    </>
                  ) : (
                    ''
                  )}
                </p>
              </div>

              {current.question.content.trim().length > 0 &&
              current.question.type !== 'fill_blank' &&
              current.question.type !== 'arrange_sentence' ? (
                <p
                  className={`ext-content${hasHan(current.question.content) ? ' cn' : ''}`}
                  lang={
                    hasHan(current.question.content) ? 'zh-Hans' : undefined
                  }
                >
                  {current.question.content}
                </p>
              ) : null}

              {audio ? (
                <div className="ext-audio">
                  {speedBlock}
                  {audioUnavailable ? (
                    <p className="ext-error">{'Không tải được âm thanh.'}</p>
                  ) : (
                    <>
                      <div className="ext-player">
                        <audio
                          key={current.question.key}
                          ref={audioRef}
                          src={audioSrc}
                          preload="none"
                          onTimeUpdate={(event) => {
                            setAudioProgress(event.currentTarget.currentTime);
                            setAudioDuration(event.currentTarget.duration || 0);
                          }}
                          onEnded={() => {
                            const key = listeningKeyRef.current;
                            if (key !== null) {
                              setPlayedKeys((previous) =>
                                new Set(previous).add(key),
                              );
                            }
                            setListeningKey(null);
                          }}
                          onError={() => {
                            onMediaError(audio.mediaId, 'audio');
                          }}
                        />
                        <div className="pq-wave" aria-hidden="true">
                          {WAVE_BARS.map(([barX], position) => {
                            const played = isBarPlayed(barX, playedFraction);
                            return (
                              <i
                                key={position}
                                className={played ? 'is-played' : undefined}
                                data-played={played ? 'true' : 'false'}
                              />
                            );
                          })}
                        </div>
                        <p className="tabular ext-audioclock">
                          <span>{formatClockMM(audioProgress)}</span>
                          <span className="ext-clocksep" aria-hidden="true">
                            {' / '}
                          </span>
                          <span>{formatClockMM(audioDuration)}</span>
                        </p>
                        <button
                          type="button"
                          className={`uxb-play${hasPlayed ? ' is-done' : ''}`}
                          aria-disabled={
                            locked || hasPlayed || isPlaying
                              ? 'true'
                              : undefined
                          }
                          aria-label={
                            hasPlayed
                              ? 'Đã nghe'
                              : isPlaying
                                ? 'Đang phát'
                                : 'Phát'
                          }
                          onClick={startAudio}
                        >
                          <svg className="icon" aria-hidden="true">
                            <use href="#i-play" />
                          </svg>
                        </button>
                      </div>
                      {playError ? (
                        <p className="ext-error">{playError}</p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              {image && imageSrc !== undefined ? (
                <img
                  className="ext-image"
                  src={imageSrc}
                  alt={`Hình minh hoạ câu ${String(current.number)}`}
                  onError={() => {
                    onMediaError(image.mediaId, 'image');
                  }}
                />
              ) : null}

              <div className="ext-answer">{answerBlock}</div>
            </div>
            <nav className="ext-qnav" aria-label="Điều hướng câu hỏi">
              <button
                type="button"
                className="btn btn--outline"
                aria-disabled={current.number === 1 ? 'true' : undefined}
                onClick={() => goTo(index - 1)}
              >
                <svg className="icon" aria-hidden="true">
                  <use href="#i-chevron-left" />
                </svg>
                Câu trước
              </button>
              <button
                type="button"
                className="btn btn--outline"
                aria-pressed={currentState.isFlagged}
                aria-disabled={locked ? 'true' : undefined}
                onClick={toggleFlag}
              >
                <svg className="icon" aria-hidden="true">
                  <use
                    href={
                      currentState.isFlagged
                        ? '#i-bookmark-fill'
                        : '#i-bookmark'
                    }
                  />
                </svg>
                Đánh dấu
              </button>
              {current.number < flat.length ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => goTo(index + 1)}
                >
                  Câu sau
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-chevron-right" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary ext-qnav__submit"
                  aria-disabled="true"
                  onClick={submitNotReady}
                >
                  Nộp bài
                </button>
              )}
            </nav>
          </section>

          <aside
            className={`ext-panel${panelOpen ? ' is-open' : ''}`}
            id="exam-panel"
            aria-label="Danh sách câu"
          >
            <div className="uxb-takepanel__head">
              <h2>Danh sách câu</h2>
              <span className="uxb-countbadge tabular">
                {answeredCount}/{flat.length}
              </span>
            </div>
            <ul className="uxb-legend">
              <li>
                <span className="uxb-legend__dot is-done" aria-hidden="true">
                  <svg className="icon">
                    <use href="#i-check" />
                  </svg>
                </span>
                Đã làm
              </li>
              <li>
                <span className="uxb-legend__dot is-new" aria-hidden="true" />
                Chưa làm
              </li>
              <li>
                <svg className="icon uxb-legend__flag" aria-hidden="true">
                  <use href="#i-bookmark" />
                </svg>
                <svg
                  className="icon uxb-legend__flag uxb-legend__flag--fill"
                  aria-hidden="true"
                >
                  <use href="#i-bookmark-fill" />
                </svg>
                Đánh dấu
              </li>
            </ul>
            <hr className="ext-panelrule" />
            <div className="uxb-qgrid">
              {flat.map((entry, position) => {
                const state = answers.get(entry.question.key);
                const done = (state?.answer ?? null) !== null;
                const flagged = state?.isFlagged ?? false;
                const label = `Câu ${String(entry.number)}, ${
                  entry.number === current.number
                    ? 'câu hiện tại'
                    : flagged
                      ? 'đánh dấu'
                      : done
                        ? 'đã làm'
                        : 'chưa làm'
                }`;
                return (
                  <button
                    key={entry.question.key}
                    type="button"
                    className={`uxb-qcell${done ? ' is-done' : ''}${flagged ? ' is-flag' : ''}`}
                    aria-label={label}
                    aria-current={
                      entry.number === current.number ? 'step' : undefined
                    }
                    onClick={() => goTo(position)}
                  >
                    {entry.number}
                  </button>
                );
              })}
            </div>
            <button
              className="btn btn--primary uxb-takefoot__submit"
              type="button"
              aria-disabled="true"
              onClick={submitNotReady}
            >
              Nộp bài
            </button>
          </aside>
        </div>
      </main>

      <footer className="ext-foot">
        <div className="ext-foot__row">
          <p className="uxb-fine">
            Còn {formatTimer(remaining)} phút. Bài làm được lưu tự động sau mỗi
            câu.
          </p>
          <button
            className="btn btn--primary uxa-submit tk-panel__submit"
            type="button"
            aria-disabled="true"
            onClick={submitNotReady}
          >
            Nộp bài
            <svg className="icon" aria-hidden="true">
              <use href="#i-check" />
            </svg>
          </button>
        </div>
      </footer>

      <dialog
        className="ext-dialog"
        ref={dialogRef}
        aria-labelledby="quit-title"
        onClose={() => setDialogKind(null)}
        onCancel={() => closeQuit()}
      >
        <h2 id="quit-title">{QUIT_TITLE}</h2>
        <p>
          {QUIT_BODY}
          {pendingCount > 0 ? ` Còn ${String(pendingCount)} câu chưa lưu.` : ''}
        </p>
        <div className="ext-dialog__actions">
          <button
            type="button"
            className="btn btn--outline"
            ref={quitButtonRef}
            onClick={() => {
              closeQuit();
            }}
          >
            Tiếp tục làm
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => void quit()}
          >
            Thoát
          </button>
        </div>
      </dialog>
    </div>
  );
}

function ChoiceGroup({
  options,
  selected,
  labelledBy,
  disabled,
  onSelect,
}: {
  options: Array<{ id: string; text: string }>;
  selected: string | null;
  labelledBy: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const ids = options.map((option) => option.id);
  const { handleKeyDown } = useRadioGroup({
    items: ids,
    onChange: (id) => {
      if (!disabled) onSelect(id);
    },
  });
  return (
    <div
      className="uxb-opts tk-opts"
      role="radiogroup"
      aria-labelledby={labelledBy}
    >
      {options.map((option, position) => {
        const isSelected = selected === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={
              selected === option.id || (selected === null && position === 0)
                ? 0
                : -1
            }
            className={`uxb-opt${isSelected ? ' is-selected' : ''}`}
            aria-disabled={disabled ? 'true' : undefined}
            onClick={() => {
              if (!disabled) onSelect(option.id);
            }}
            onKeyDown={(event) => handleKeyDown(event, position)}
          >
            <span className="uxb-opt__radio" aria-hidden="true" />
            <span className="uxb-opt__key" aria-hidden="true">
              {String.fromCharCode(65 + position)}
            </span>
            <span className="uxb-opt__text">
              <ChoiceText text={option.text} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
