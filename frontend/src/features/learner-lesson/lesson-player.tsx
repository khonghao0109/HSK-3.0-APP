'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import { useRadioGroup } from '@/features/onboarding/use-radio-group';

import {
  buildAnswer,
  FILL_BLANK_MAX_LENGTH,
  hasHan,
  matchingProgress,
  newAttemptKey,
  progressClass,
  splitBlank,
  topicToClose,
  type MatchingMove,
  type PlayerAnswer,
  type PlayerChoice,
  type PlayerExercise,
  type PlayerInput,
} from './lesson-player-model';
import { ListeningExercise, type ListeningSpeed } from './listening-exercise';
import { MatchingExercise } from './matching-exercise';
import { Icon } from '@/components/ui/icon';

export const PLAYER_MESSAGES = {
  correctTitle: 'Chính xác',
  correctText: 'Câu của bạn hoàn toàn đúng.',
  wrongTitle: 'Chưa đúng',
  soon: 'Dạng bài này sắp ra mắt.',
  done: 'Bạn đã làm xong phần luyện tập',
  empty: 'Bài học này chưa có bài tập.',
  submitFailed: 'Không gửi được câu trả lời. Vui lòng thử lại.',
  startFailed: 'Chưa mở được bài luyện tập. Vui lòng thử lại.',
  finishing: 'Đang lưu kết quả bài học…',
  grading: 'Đang chấm…',
  finishFailed: 'Chưa lưu được kết quả bài học. Vui lòng thử lại.',
  matchingCorrectText: (pairs: number) => `Bạn đã ghép đúng cả ${pairs} cặp.`,
  matchingDoneTitle: (mistakes: number) => `Hoàn thành · Sai ${mistakes} lần`,
} as const;

type StartOutcome = 'started' | 'sign-in' | 'lesson' | 'failed';

/** Q-G9: the authored answer the BFF forwards only after a wrong attempt. */
type CorrectAnswer =
  { optionId: string } | { acceptedTexts: string[] } | { tokenIds: string[] };

type Result = {
  correct: boolean;
  explanation: string | null;
  correctAnswer: CorrectAnswer | null;
};

/** Key and duration of the answer in flight: a retry of it reuses both. */
type Pending = {
  exerciseId: number;
  answer: string;
  key: string;
  durationSeconds: number;
};

const EMPTY_INPUT: PlayerInput = { optionId: null, tokenIds: [], text: '' };

export function ChoiceText({ text }: { text: string }) {
  return hasHan(text) ? (
    <span className="cn" lang="zh-Hans">
      {text}
    </span>
  ) : (
    <span>{text}</span>
  );
}

/** Whole seconds since `start`, kept within the attempt contract (0–86 400). */
function secondsSince(start: number): number {
  return Math.min(86_400, Math.max(0, Math.round((Date.now() - start) / 1000)));
}

function readResult(body: unknown): Result | null {
  if (typeof body !== 'object' || body === null) return null;
  const data: unknown = Reflect.get(body, 'data');
  if (typeof data !== 'object' || data === null) return null;
  const isCorrect: unknown = Reflect.get(data, 'isCorrect');
  const explanation: unknown = Reflect.get(data, 'explanation');
  if (typeof isCorrect !== 'boolean') return null;
  if (explanation !== null && typeof explanation !== 'string') return null;
  return {
    correct: isCorrect,
    explanation: explanation?.trim() || null,
    correctAnswer: readCorrectAnswer(data),
  };
}

/** Reads the revealed answer defensively; a missing or odd shape yields null. */
function readCorrectAnswer(data: object): CorrectAnswer | null {
  const value: unknown = Reflect.get(data, 'correctAnswer');
  if (typeof value !== 'object' || value === null) return null;
  const optionId: unknown = Reflect.get(value, 'optionId');
  if (typeof optionId === 'string') return { optionId };
  const acceptedTexts: unknown = Reflect.get(value, 'acceptedTexts');
  if (isNonEmptyStringArray(acceptedTexts)) return { acceptedTexts };
  const tokenIds: unknown = Reflect.get(value, 'tokenIds');
  if (isNonEmptyStringArray(tokenIds)) return { tokenIds };
  return null;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string')
  );
}

/**
 * The correct answer as display text, or null when it cannot be resolved (an
 * option/token id not in this exercise, matching, or a correct attempt). Null
 * renders nothing rather than crashing.
 */
function resolveCorrectAnswerText(
  current: PlayerExercise | undefined,
  answer: CorrectAnswer,
  choices: PlayerChoice[],
): string | null {
  if ('optionId' in answer) {
    return (
      choices.find((option) => option.id === answer.optionId)?.text ?? null
    );
  }
  if ('acceptedTexts' in answer) {
    return answer.acceptedTexts[0] ?? null;
  }
  if (current?.kind !== 'arrange_sentence') return null;
  const textById = new Map(
    current.tokens.map((token) => [token.id, token.text]),
  );
  const parts = answer.tokenIds.map((id) => textById.get(id));
  if (parts.some((part) => part === undefined)) return null;
  return parts.join('');
}

/** Sentence-ending marks after which the spoken join needs no extra period. */
const SPOKEN_SENTENCE_END = /[.。!?！？]$/u;

/**
 * Joins the spoken (aria-live) result with ". " between parts, but only a
 * space when a part already ends in sentence punctuation — so an explanation
 * ending in "." or "。" is not read back as a double stop (G3c).
 */
function joinSpoken(parts: Array<string | false | null | undefined>): string {
  return parts.reduce<string>((spoken, part) => {
    if (!part) return spoken;
    if (spoken === '') return part;
    return `${spoken}${SPOKEN_SENTENCE_END.test(spoken) ? ' ' : '. '}${part}`;
  }, '');
}

/**
 * Activity player (M2.5b, Q45–Q50): one exercise at a time, checked by the
 * backend. Exercises the player cannot show yet only count towards x/y (Q48).
 * M2.5d (Q58): Tiếp tục after a topic's last exercise closes the topic, and
 * once every exercise has an attempt the lesson is completed and the player
 * moves to the complete page; opening it with all answered does the same.
 * A lesson without exercises is only completed by its own button.
 */
export function LessonPlayer({
  lessonId,
  lessonTitle,
  exercises,
  startIndex,
  needsStart,
  lessonDone,
}: {
  lessonId: number;
  /** M2.10b: web kicker "lesson · type" (mẫu practice-*.html); optional so
      the mobile-only render paths stay unchanged. */
  lessonTitle?: string;
  exercises: PlayerExercise[];
  startIndex: number;
  needsStart: boolean;
  lessonDone: boolean;
}) {
  const router = useRouter();
  const lessonHref = `/learn/lessons/${lessonId}`;
  const total = exercises.length;
  const empty = total === 0;
  // `every` is true for an empty list: opening must not complete such a lesson.
  const allAnsweredAtOpen =
    !empty &&
    startIndex >= total &&
    exercises.every((exercise) => exercise.answered);

  const [index, setIndex] = useState(startIndex);
  const [input, setInput] = useState<PlayerInput>(EMPTY_INPUT);
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(!needsStart);
  const [startFailed, setStartFailed] = useState(false);
  const [answeredIds, setAnsweredIds] = useState<ReadonlySet<number>>(
    () =>
      new Set(
        exercises
          .filter((exercise) => exercise.answered)
          .map((exercise) => exercise.id),
      ),
  );
  const [completion, setCompletion] = useState<'idle' | 'busy' | 'failed'>(
    allAnsweredAtOpen ? 'busy' : 'idle',
  );
  // M2.5e (Q171, TL-201): one choice for every listening question of this
  // lesson-player turn. It lives here because ListeningExercise is keyed by
  // exercise id; leaving the page resets it to 1×.
  const [listeningSpeed, setListeningSpeed] = useState<ListeningSpeed>('1');
  // Pha G2a: the option the arrow keys moved to (roving tabindex only).
  const [rovingId, setRovingId] = useState<string | null>(null);

  const submittingRef = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  const shownAtRef = useRef(0);
  const movedRef = useRef(false);
  const focusRef = useRef<'bank' | 'answer' | null>(null);
  const bodyRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const checkRef = useRef<HTMLButtonElement>(null);

  const current: PlayerExercise | undefined = exercises[index];
  const answer = current ? buildAnswer(current, input) : null;
  const locked = submitting || result !== null;
  const canCheck = answer !== null && !locked && !startFailed;

  // Resolves to what the start call means for the page; the state change
  // happens in the callback, never synchronously in the effect.
  const requestStart = useCallback(async (): Promise<StartOutcome> => {
    try {
      const response = await fetch(`/api/learner/lessons/${lessonId}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      // Drain the body: an unread response keeps the request open.
      await response.text().catch(() => '');
      if (response.status === 200) return 'started';
      // The BFF clears the session cookies on both.
      if (response.status === 401 || response.status === 403) return 'sign-in';
      // Locked (Q18) or gone: the lesson page shows why.
      if (response.status === 404 || response.status === 409) return 'lesson';
    } catch {
      // Network failure: offer a retry.
    }
    return 'failed';
  }, [lessonId]);

  const applyStart = useCallback(
    (outcome: StartOutcome) => {
      if (outcome === 'started') setStarted(true);
      else if (outcome === 'sign-in') router.replace('/sign-in');
      else if (outcome === 'lesson') router.replace(lessonHref);
      else setStartFailed(true);
      return outcome;
    },
    [lessonHref, router],
  );

  // The start in flight: a check made before it answers waits for it.
  const startRef = useRef<Promise<StartOutcome> | null>(null);

  // Once per mount: the key is fixed per lesson, so even a repeat would only
  // replay, but there is no reason to send it again.
  useEffect(() => {
    if (!needsStart || startRef.current) return;
    startRef.current = requestStart().then(applyStart);
  }, [needsStart, requestStart, applyStart]);

  // Topic closes in flight: the lesson complete waits for them (Q58). A
  // failed close is left to the complete BFF, which closes it again.
  const closingRef = useRef<Promise<unknown>[]>([]);
  const closeTopic = useCallback(
    (topicId: number) => {
      closingRef.current.push(
        fetch(`/api/learner/topics/${topicId}/complete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lessonId }),
        })
          .then((response) => response.text())
          .catch(() => ''),
      );
    },
    [lessonId],
  );

  // Completes the lesson and moves to its complete page; on failure the done
  // card offers a retry. State changes only after an await.
  const finishingRef = useRef(false);
  const finish = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    let outcome: StartOutcome = startRef.current
      ? await startRef.current
      : 'started';
    if (outcome === 'failed') {
      startRef.current = requestStart().then(applyStart);
      outcome = await startRef.current;
    }
    // applyStart already left the page.
    if (outcome === 'sign-in' || outcome === 'lesson') return;
    if (outcome === 'started') {
      await Promise.all(closingRef.current);
      try {
        const response = await fetch(
          `/api/learner/lessons/${lessonId}/complete`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          },
        );
        await response.text().catch(() => '');
        if (response.status === 200) {
          router.replace(`${lessonHref}/complete`);
          return;
        }
        if (response.status === 401 || response.status === 403) {
          router.replace('/sign-in');
          return;
        }
      } catch {
        // Network failure: offer a retry.
      }
    }
    finishingRef.current = false;
    setCompletion('failed');
  }, [applyStart, lessonHref, lessonId, requestStart, router]);

  // Opened with every exercise answered (even a done lesson): complete now.
  const finishOnOpenRef = useRef(allAnsweredAtOpen);
  useEffect(() => {
    if (!finishOnOpenRef.current) return;
    finishOnOpenRef.current = false;
    void finish();
  }, [finish]);

  // A new exercise: time it from now and, after Tiếp tục, move focus to its
  // prompt so keyboard and screen reader users start there.
  useEffect(() => {
    shownAtRef.current = Date.now();
    if (movedRef.current) headingRef.current?.focus();
  }, [index]);

  useEffect(() => {
    if (result) continueRef.current?.focus();
  }, [result]);

  // arrange_sentence: keep focus on a word after the one tapped moves away.
  useEffect(() => {
    const target = focusRef.current;
    focusRef.current = null;
    const root = bodyRef.current;
    if (!target || !root) return;
    const next =
      target === 'bank'
        ? root.querySelector<HTMLElement>(
            '.pr-bank .pr-chip:not([aria-disabled="true"])',
          )
        : root.querySelector<HTMLElement>(
            '.pr-answer__row .pr-chip:last-child',
          );
    const fallback =
      target === 'bank'
        ? checkRef.current
        : (root.querySelector<HTMLElement>(
            '.pr-bank .pr-chip:not([aria-disabled="true"])',
          ) ?? headingRef.current);
    (next ?? fallback)?.focus();
  }, [input]);

  const retryFinish = () => {
    // The heading stays mounted, so focus does not drop to the body.
    headingRef.current?.focus();
    setCompletion('busy');
    void finish();
  };

  // The button stays mounted (aria-disabled), so focus stays on it.
  const finishEmpty = () => {
    if (completion === 'busy') return;
    setCompletion('busy');
    void finish();
  };

  const retryStart = () => {
    setStartFailed(false);
    startRef.current = requestStart().then(applyStart);
  };

  // `sent` lets the last matching move send its log before the state lands.
  const submit = async (sent: PlayerAnswer | null = answer) => {
    if (!current || !sent || result || startFailed) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    if (!started && (await startRef.current) !== 'started') {
      // applyStart already redirected or offered the retry.
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    const serialized = JSON.stringify(sent);
    let pending = pendingRef.current;
    if (
      !pending ||
      pending.exerciseId !== current.id ||
      pending.answer !== serialized
    ) {
      pending = {
        exerciseId: current.id,
        answer: serialized,
        key: newAttemptKey(),
        durationSeconds: secondsSince(shownAtRef.current),
      };
      pendingRef.current = pending;
    }

    try {
      const response = await fetch(
        `/api/learner/exercises/${current.id}/attempts`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': pending.key,
          },
          body: JSON.stringify({
            answer: sent,
            durationSeconds: pending.durationSeconds,
          }),
        },
      );
      if (response.status === 401 || response.status === 403) {
        router.replace('/sign-in');
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const checked = response.status === 200 ? readResult(body) : null;
      if (checked) {
        pendingRef.current = null;
        const answeredId = current.id;
        setAnsweredIds((ids) => new Set(ids).add(answeredId));
        setResult(checked);
      } else {
        setError(PLAYER_MESSAGES.submitFailed);
      }
    } catch {
      setError(PLAYER_MESSAGES.submitFailed);
    }
    submittingRef.current = false;
    setSubmitting(false);
  };

  const next = () => {
    const last = index + 1 >= total;
    const topicId = topicToClose(exercises, index, answeredIds);
    // After the last exercise the complete BFF closes the topic itself.
    if (topicId !== null && !last) closeTopic(topicId);
    if (last && exercises.every((exercise) => answeredIds.has(exercise.id))) {
      setCompletion('busy');
      void finish();
    }
    movedRef.current = true;
    pendingRef.current = null;
    setIndex((value) => value + 1);
    setInput(EMPTY_INPUT);
    setRovingId(null);
    setResult(null);
    setError(null);
  };

  const choices =
    current?.kind === 'mcq' || current?.kind === 'listening'
      ? current.options
      : [];
  // Pha G2a (PO 20/11/2026, thay Q51/N4): choosing sends the answer at once;
  // the server still grades it. Choosing it again after a failed send resends
  // it with the same key.
  const chooseOption = (optionId: string) => {
    // The ref also stops a second click in the same tick, before `locked`.
    if (locked || submittingRef.current || !current) return;
    setRovingId(optionId);
    setInput((value) => ({ ...value, optionId }));
    void submit(buildAnswer(current, { ...input, optionId }));
  };
  const optionIds = choices.map((option) => option.id);
  // Arrows only move focus; Enter and Space click the focused option.
  const radio = useRadioGroup({ items: optionIds, onChange: setRovingId });
  const tabStop = rovingId ?? input.optionId ?? optionIds[0];

  const addToken = (id: string) => {
    if (locked || input.tokenIds.includes(id)) return;
    focusRef.current = 'bank';
    setInput((value) => ({ ...value, tokenIds: [...value.tokenIds, id] }));
  };

  const removeToken = (id: string) => {
    if (locked) return;
    focusRef.current = 'answer';
    setInput((value) => ({
      ...value,
      tokenIds: value.tokenIds.filter((tokenId) => tokenId !== id),
    }));
  };

  // Pha E: the move that locks the last pair sends the whole log.
  const addMove = (move: MatchingMove) => {
    if (locked || current?.kind !== 'matching') return;
    const moves = [...(input.moves ?? []), move];
    setInput((value) => ({ ...value, moves }));
    const complete = buildAnswer(current, { ...input, moves });
    if (complete) void submit(complete);
  };
  const matchingMistakes =
    current?.kind === 'matching'
      ? matchingProgress(input.moves ?? []).mistakes
      : 0;

  const onTextKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter that ends an IME composition only commits the text.
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const options = choices.length > 0 && (
    <div
      className="ls-options"
      role="radiogroup"
      aria-labelledby="ex-q"
      aria-busy={submitting || undefined}
    >
      {choices.map((option, optionIndex) => {
        const checked = input.optionId === option.id;
        const focusable = option.id === tabStop;
        const mark = result && checked;
        // Q-G9: on a miss, highlight the authored option too, not just the pick.
        const isAnswer =
          result !== null &&
          !result.correct &&
          result.correctAnswer !== null &&
          'optionId' in result.correctAnswer &&
          result.correctAnswer.optionId === option.id;
        const state = isAnswer
          ? 'is-right'
          : mark
            ? result.correct
              ? 'is-right'
              : 'is-wrong'
            : '';
        const className = ['ls-opt', state].filter(Boolean).join(' ');
        return (
          <button
            key={option.id}
            className={className}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={locked ? 'true' : undefined}
            tabIndex={focusable ? 0 : -1}
            onClick={() => chooseOption(option.id)}
            onKeyDown={(event) => radio.handleKeyDown(event, optionIndex)}
          >
            <ChoiceText text={option.text} />
            {(mark || isAnswer) && (
              <Icon
                name={state === 'is-right' ? 'check-circle' : 'x-circle'}
                className="ls-opt__mark"
              />
            )}
          </button>
        );
      })}
    </div>
  );

  const correctText =
    current?.kind === 'matching'
      ? PLAYER_MESSAGES.matchingCorrectText(current.pairs.length)
      : PLAYER_MESSAGES.correctText;
  const wrongTitle =
    current?.kind === 'matching'
      ? PLAYER_MESSAGES.matchingDoneTitle(matchingMistakes)
      : PLAYER_MESSAGES.wrongTitle;
  // Q-G9: the authored answer to show after a wrong attempt (null hides it).
  const correctAnswerText =
    result && !result.correct && result.correctAnswer
      ? resolveCorrectAnswerText(current, result.correctAnswer, choices)
      : null;
  const correctAnswerLabel =
    current?.kind === 'arrange_sentence' ? 'Câu đúng' : 'Đáp án đúng';
  const sendsItself =
    current?.kind === 'mcq' ||
    current?.kind === 'listening' ||
    current?.kind === 'matching';
  const announcement = result
    ? result.correct
      ? joinSpoken([PLAYER_MESSAGES.correctTitle, correctText])
      : joinSpoken([
          wrongTitle,
          result.explanation,
          correctAnswerText && `${correctAnswerLabel}: ${correctAnswerText}`,
        ])
    : completion === 'busy'
      ? PLAYER_MESSAGES.finishing
      : submitting && choices.length > 0
        ? PLAYER_MESSAGES.grading
        : '';
  const done = index >= total;
  const shown = done ? total : index + 1;
  const answeredCount = done ? total : index + (result ? 1 : 0);

  return (
    <div className="ex">
      {/* Spoken result, always mounted: text only, so it does not compete
          with focus moving to Tiếp tục. */}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <header className="m02-head m02-bar ex-bar">
        <Link
          className="icon-btn"
          href={lessonHref}
          aria-label="Thoát bài luyện tập"
        >
          <Icon name="x" />
        </Link>
        {/* M2.10b: `.ex-track` groups the title with the bar's progress copy
            (mẫu .pq-track); display:contents below 1024px keeps the mobile
            bar exactly as it was. */}
        <div className="ex-track">
          <h1 className="m02-bar__title">Luyện tập</h1>
          {total > 0 && (
            <div
              className="progress ex-progress ex-progress--web w-only"
              role="progressbar"
              aria-label="Tiến độ luyện tập"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={answeredCount}
            >
              <span className={progressClass(answeredCount, total)} />
            </div>
          )}
        </div>
        {total > 0 && (
          <p
            className="m02-bar__count"
            aria-label={`Câu ${shown} trên ${total}`}
          >
            {`${shown}/${total}`}
          </p>
        )}
      </header>

      <main className="m02-sheet ex-body" ref={bodyRef}>
        {/* M2.10b: web kicker (mẫu practice-mcq/listening.html). Only the two
            mocked types carry the sample's own label; the others show the
            lesson title alone (no invented copy). */}
        {lessonTitle && (
          <p className="pq-kicker w-only">
            {current?.kind === 'mcq'
              ? `${lessonTitle} · Trắc nghiệm`
              : current?.kind === 'listening'
                ? `${lessonTitle} · Nghe hiểu`
                : lessonTitle}
          </p>
        )}
        {!empty && (
          <div
            className="progress ex-progress m-only"
            role="progressbar"
            aria-label="Tiến độ luyện tập"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={answeredCount}
          >
            <span className={progressClass(answeredCount, total)} />
          </div>
        )}

        {empty && (
          <section className="ex-done" aria-labelledby="ex-q">
            <h2
              className="ex-done__title"
              id="ex-q"
              ref={headingRef}
              tabIndex={-1}
            >
              {PLAYER_MESSAGES.empty}
            </h2>
            {completion === 'busy' && <p>{PLAYER_MESSAGES.finishing}</p>}
            {completion === 'failed' && (
              <p className="ex-error" role="alert">
                {PLAYER_MESSAGES.finishFailed}
              </p>
            )}
            {!lessonDone && (
              <button
                className="lesson-cta"
                type="button"
                aria-disabled={completion === 'busy' ? 'true' : undefined}
                aria-busy={completion === 'busy' || undefined}
                onClick={finishEmpty}
              >
                {completion === 'failed' ? 'Thử lại' : 'Hoàn thành bài học'}
              </button>
            )}
            <Link className="btn btn--outline btn--block" href={lessonHref}>
              Về bài học
            </Link>
          </section>
        )}

        {done && !empty && (
          <section className="ex-done" aria-labelledby="ex-q">
            <h2
              className="ex-done__title"
              id="ex-q"
              ref={headingRef}
              tabIndex={-1}
            >
              {PLAYER_MESSAGES.done}
            </h2>
            {completion === 'busy' && <p>{PLAYER_MESSAGES.finishing}</p>}
            {completion === 'failed' && (
              <>
                <p className="ex-error" role="alert">
                  {PLAYER_MESSAGES.finishFailed}
                </p>
                <button
                  className="lesson-cta"
                  type="button"
                  onClick={retryFinish}
                >
                  Thử lại
                </button>
              </>
            )}
            {/* Some exercise has no attempt (a type the player cannot show,
                Q48): the lesson cannot be completed yet. */}
            {completion === 'idle' && (
              <Link className="lesson-cta" href={lessonHref}>
                Về bài học
              </Link>
            )}
          </section>
        )}

        {current?.kind === 'unsupported' && (
          <section className="ex-soon" aria-labelledby="ex-q">
            <h2
              className="ex-soon__title"
              id="ex-q"
              ref={headingRef}
              tabIndex={-1}
            >
              {PLAYER_MESSAGES.soon}
            </h2>
            <button className="m02-feedback__btn" type="button" onClick={next}>
              Tiếp tục
            </button>
          </section>
        )}

        {current?.kind === 'arrange_sentence' && (
          <ArrangeSentence
            key={current.id}
            prompt={current.prompt}
            tokens={current.tokens}
            tokenIds={input.tokenIds}
            locked={locked}
            result={result}
            headingRef={headingRef}
            onAdd={addToken}
            onRemove={removeToken}
          />
        )}

        {current?.kind === 'mcq' && (
          <>
            <h2 className="pr-q" id="ex-q" ref={headingRef} tabIndex={-1}>
              {current.prompt}
            </h2>
            {options}
          </>
        )}

        {current?.kind === 'listening' && (
          <ListeningExercise
            key={current.id}
            prompt={current.prompt}
            media={current.media}
            headingRef={headingRef}
            speed={listeningSpeed}
            onSpeedChange={setListeningSpeed}
          >
            {options}
          </ListeningExercise>
        )}

        {current?.kind === 'matching' && (
          <MatchingExercise
            key={current.id}
            prompt={current.prompt}
            pairs={current.pairs}
            rightOrder={current.rightOrder}
            moves={input.moves ?? []}
            locked={locked}
            headingRef={headingRef}
            onMove={addMove}
          />
        )}

        {current?.kind === 'fill_blank' && (
          <FillBlank
            key={current.id}
            prompt={current.prompt}
            text={input.text}
            locked={locked}
            headingRef={headingRef}
            onChange={(text) => setInput((value) => ({ ...value, text }))}
            onKeyDown={onTextKeyDown}
          />
        )}
      </main>

      {!done && current?.kind !== 'unsupported' && (
        <footer className="ex-foot">
          <div>
            {/* M2.10b: the web foot's hint (mẫu .pq-foot__hint); the mobile
                foot only carries the button. */}
            {/* F6: chỉ các dạng chọn đáp án (mcq, listening) có hint này;
                arrange_sentence và fill_blank có hướng dẫn riêng. */}
            {!result &&
              !error &&
              !startFailed &&
              (current?.kind === 'mcq' || current?.kind === 'listening') && (
                <p className="pq-foot__hint w-only">Chọn một đáp án.</p>
              )}
            {result?.correct === true && (
              <div className="m02-feedback">
                <Icon
                  name="check-circle"
                  className="m02-feedback__icon m02-feedback__icon--ok"
                />
                <div className="grow">
                  <p className="m02-feedback__title">
                    {PLAYER_MESSAGES.correctTitle}
                  </p>
                  <p className="m02-feedback__text">{correctText}</p>
                </div>
                <button
                  className="m02-feedback__btn"
                  type="button"
                  ref={continueRef}
                  onClick={next}
                >
                  Tiếp tục
                </button>
              </div>
            )}
            {result?.correct === false && (
              <div
                className={
                  current?.kind === 'matching'
                    ? 'm02-feedback m02-feedback--neutral'
                    : 'm02-feedback m02-feedback--wrong'
                }
              >
                <Icon
                  name={
                    current?.kind === 'matching'
                      ? 'check-circle-line'
                      : 'x-circle'
                  }
                  className="m02-feedback__icon"
                />
                <div className="grow">
                  <p className="m02-feedback__title">{wrongTitle}</p>
                  {result.explanation && (
                    <p className="m02-feedback__text">{result.explanation}</p>
                  )}
                  {correctAnswerText && (
                    <p className="m02-feedback__text">
                      {`${correctAnswerLabel}: `}
                      <ChoiceText text={correctAnswerText} />
                    </p>
                  )}
                </div>
                <button
                  className="m02-feedback__btn"
                  type="button"
                  ref={continueRef}
                  onClick={next}
                >
                  Tiếp tục
                </button>
              </div>
            )}
            {error && (
              <p className="ex-error" role="alert">
                {error}
              </p>
            )}
            {startFailed && (
              <p className="ex-error" role="alert">
                {PLAYER_MESSAGES.startFailed}
              </p>
            )}
          </div>
          {/* One node for Xác nhận and Thử lại, so focus survives the swap.
              A choice and a matching log send themselves; for them the
              button only resends a failed answer (Pha G2a). */}
          {!result && (!sendsItself || error || startFailed) && (
            <button
              className="ex-check"
              type="button"
              ref={checkRef}
              aria-disabled={startFailed || canCheck ? undefined : 'true'}
              aria-busy={submitting || undefined}
              onClick={startFailed ? retryStart : () => void submit()}
            >
              {startFailed || (sendsItself && !submitting)
                ? 'Thử lại'
                : submitting
                  ? 'Đang kiểm tra…'
                  : 'Xác nhận'}
            </button>
          )}
        </footer>
      )}
    </div>
  );
}

export function ArrangeSentence({
  prompt,
  tokens,
  tokenIds,
  locked,
  result,
  headingRef,
  onAdd,
  onRemove,
}: {
  prompt: string;
  tokens: PlayerChoice[];
  tokenIds: string[];
  locked: boolean;
  result: Result | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const answerState = result
    ? result.correct
      ? ' is-right'
      : ' is-wrong'
    : '';
  return (
    <>
      <h2 className="pr-q" id="ex-q" ref={headingRef} tabIndex={-1}>
        {prompt}
      </h2>
      <p className="pr-hint" id="pr-hint">
        (Chạm vào từ để ghép câu)
      </p>
      <div
        className="pr-bank"
        role="group"
        aria-label="Các từ để chọn"
        aria-describedby="pr-hint"
      >
        {tokens.map((token) => {
          const used = tokenIds.includes(token.id);
          const han = hasHan(token.text);
          return (
            <button
              key={token.id}
              className={`pr-chip${used ? ' is-used' : ''}${han ? ' cn' : ''}`}
              lang={han ? 'zh-Hans' : undefined}
              type="button"
              aria-disabled={used || locked ? 'true' : undefined}
              aria-label={
                used ? `${token.text}, đã dùng` : `Thêm ${token.text}`
              }
              onClick={() => onAdd(token.id)}
            >
              {token.text}
            </button>
          );
        })}
      </div>
      <div className="pr-answer">
        <div
          className="pr-answer__row"
          role="group"
          aria-label="Câu trả lời của bạn"
        >
          {tokenIds.length === 0 ? (
            <span className="pr-answer__empty">
              Chạm vào các từ ở trên để ghép câu
            </span>
          ) : (
            tokenIds.map((id) => {
              const token = byId.get(id);
              if (!token) return null;
              const han = hasHan(token.text);
              return (
                <button
                  key={id}
                  className={`pr-chip pr-chip--answer${answerState}${han ? ' cn' : ''}`}
                  lang={han ? 'zh-Hans' : undefined}
                  type="button"
                  aria-disabled={locked ? 'true' : undefined}
                  aria-label={`Bỏ ${token.text} khỏi câu`}
                  onClick={() => onRemove(id)}
                >
                  {token.text}
                </button>
              );
            })
          )}
        </div>
        <Icon
          name="check-circle"
          className={`pr-answer__ok${result?.correct ? '' : ' is-hidden'}`}
        />
      </div>
    </>
  );
}

export function FillBlank({
  prompt,
  text,
  locked,
  headingRef,
  onChange,
  onKeyDown,
  maxLength = FILL_BLANK_MAX_LENGTH,
  onBlur,
}: {
  prompt: string;
  text: string;
  locked: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** The exam passes 200; the lesson keeps its own larger bound. */
  maxLength?: number;
  onBlur?: () => void;
}) {
  const [before, after] = splitBlank(prompt);
  const filled = text.trim();
  return (
    <>
      <h2 className="pr-q fb-q" id="ex-q" ref={headingRef} tabIndex={-1}>
        {before}
        <span className="fb-blank" aria-hidden="true">
          {filled || ' '}
        </span>
        <span className="sr-only">(chỗ trống)</span>
        {after}
      </h2>
      <div className="fb-field">
        <label htmlFor="fb-input">Câu trả lời của bạn</label>
        <input
          className="input"
          id="fb-input"
          type="text"
          value={text}
          maxLength={maxLength}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          readOnly={locked}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
      </div>
    </>
  );
}
