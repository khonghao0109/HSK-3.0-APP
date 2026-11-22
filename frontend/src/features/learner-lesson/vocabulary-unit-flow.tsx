'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/ui/icon';
import { percentClass } from '@/features/learner-home/percent';
import { useRadioGroup } from '@/features/onboarding/use-radio-group';

import { LessonImage } from './lesson-image';
import { PLAYER_MESSAGES } from './lesson-player';
import { PracticeBar } from './practice-bar';
import type { StrokeCache } from './stroke-data';
import { UnitResult } from './unit-result';
import { VocabularyDrill } from './vocabulary-drill';
import { SPEECH_RATE, SPEECH_RATE_SLOW, useChineseVoice } from './speech';
import { answerMark, type UnitStep, type UnitWord } from './vocabulary-unit';

type Props = {
  lessonId: number;
  topicId: number;
  /** "Từ vựng 2 · Gia đình" */
  title: string;
  lessonHref: string;
  /** Next unit after this one, when it is open (mẫu "Đơn vị tiếp"). */
  nextHref: string | null;
  words: UnitWord[];
  steps: UnitStep[];
};

/** "nhà; gia đình" -> "nhà, gia đình" in the feedback sentence (mẫu). */
const spoken = (meaning: string) => meaning.replaceAll('; ', ', ');

/** The example with each occurrence of the word marked (mẫu `.g-ex__cn`). */
function markWord(sentence: string, target: string): ReactNode[] {
  if (!target) return [sentence];
  return sentence
    .split(target)
    .flatMap((part, partIndex) =>
      partIndex === 0 ? [part] : [<mark key={partIndex}>{target}</mark>, part],
    )
    .filter((part) => part !== '');
}

/**
 * Step-by-step Từ vựng unit (PO 20/11/2026, N3/N8; Pha G2a mẫu vu-card,
 * vu-card-noimg, vu-example, vu-quiz; unit-complete). Frame of the player
 * (`.ex`). A meaning is graded the moment it is chosen (thay Q51/N4); the
 * arrow keys only move focus. Nghe needs a zh voice on the device.
 */
export function VocabularyUnitFlow(props: Props) {
  const { lessonHref, title, words } = props;
  const { available, speak } = useChineseVoice();
  // Pha G2c: no zh voice, no "nghe rồi sắp xếp" (as Nghe is hidden, G2a).
  const steps = available
    ? props.steps
    : props.steps.filter((candidate) => candidate.kind !== 'listen');
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [focused, setFocused] = useState(0);
  // Wrong answers per word index (Pha C debt 3b).
  const [results, setResults] = useState<Record<number, number>>({});
  // Viết: one stroke read per word for this unit (G2d), on the card being shown.
  const [strokeCache] = useState<StrokeCache>(() => new Map());
  const continueRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLElement>(null);
  const moved = useRef(false);

  const step = steps[index];
  const options = step?.kind === 'quiz' ? step.options : [];
  const checked = selected !== null;
  // Arrows move the roving focus only; choosing is a click, Enter or Space.
  const radio = useRadioGroup({
    items: options.map((_, optionIndex) => optionIndex),
    onChange: setFocused,
  });

  useEffect(() => {
    if (checked) continueRef.current?.focus();
  }, [checked]);
  useEffect(() => {
    // Focus follows the step after a click, not on first render.
    if (moved.current) headingRef.current?.focus();
  }, [index]);

  if (!step) {
    return <VocabularyResult {...props} steps={steps} results={results} />;
  }

  const go = (to: number) => {
    moved.current = true;
    setIndex(to);
    setSelected(null);
    setFocused(0);
  };
  const choose = (optionIndex: number) => {
    if (step.kind !== 'quiz' || checked) return;
    setSelected(optionIndex);
    setResults((previous) => ({
      ...previous,
      [step.word]:
        (previous[step.word] ?? 0) + (optionIndex === step.answer ? 0 : 1),
    }));
  };

  const total = steps.length;
  const shown = index + 1;
  const correct = step.kind === 'quiz' && selected === step.answer;
  const progress = (className: string) => (
    <div
      className={className}
      role="progressbar"
      aria-label="Tiến độ đơn vị"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={shown}
    >
      <span className={percentClass((shown / total) * 100)} />
    </div>
  );
  const header = (
    <header className="m02-head m02-bar ex-bar">
      <Link
        className="icon-btn"
        href={lessonHref}
        aria-label="Thoát về bài học"
      >
        <Icon name="x" />
      </Link>
      <div className="ex-track">
        <h1 className="m02-bar__title">{title}</h1>
        {progress('progress ex-progress ex-progress--web w-only')}
      </div>
      <p className="m02-bar__count" aria-label={`Bước ${shown} trên ${total}`}>
        {`${shown}/${total}`}
      </p>
    </header>
  );
  // mẫu mobile `.uxa-progress`: thanh + số bước bên cạnh.
  const mobileProgress = (
    <div className="lu-progress m-only">
      {progress('progress')}
      <span className="lu-progress__count" aria-hidden="true">
        {`${shown}/${total}`}
      </span>
    </div>
  );

  if (
    step.kind === 'match' ||
    step.kind === 'fill' ||
    step.kind === 'arrange' ||
    step.kind === 'listen'
  ) {
    const drills = steps.filter((candidate) => !('word' in candidate));
    return (
      <div className="ex lu-flow">
        {header}
        <VocabularyDrill
          key={index}
          step={step}
          place={drills.indexOf(step) + 1}
          count={drills.length}
          progress={mobileProgress}
          headingRef={headingRef}
          speak={speak}
          onNext={() => go(index + 1)}
        />
      </div>
    );
  }

  const word = words[step.word];
  if (!word) return null;
  const head = <span lang="zh-Hans">{word.hanzi}</span>;
  const meaning = spoken(word.meaning ?? '');
  const feedback = correct
    ? `${word.hanzi} ${word.pinyin} nghĩa là ${meaning}.`
    : `Đáp án đúng: ${word.hanzi} ${word.pinyin} là ${meaning}.`;
  const sayText =
    step.kind === 'example' && word.example ? word.example.hanzi : word.hanzi;

  return (
    <div className="ex lu-flow">
      <p className="sr-only" role="status" aria-live="polite">
        {step.kind === 'quiz' && checked
          ? `${correct ? PLAYER_MESSAGES.correctTitle : PLAYER_MESSAGES.wrongTitle}. ${feedback}`
          : ''}
      </p>
      {header}

      <main className="m02-sheet ex-body">
        {mobileProgress}

        <div className="g-body">
          {step.kind === 'card' && (
            <section
              className={`g-card${word.image ? '' : ' g-card--noimg'}`}
              aria-labelledby="lu-word"
            >
              {word.image && (
                <div className="g-media">
                  <LessonImage
                    mediaId={word.image.id}
                    altText={word.image.altText}
                  />
                </div>
              )}
              <p className="g-py" lang="zh-Latn-pinyin">
                {word.pinyin}
              </p>
              <h2
                className="g-hz"
                id="lu-word"
                lang="zh-Hans"
                ref={(node) => {
                  headingRef.current = node;
                }}
                tabIndex={-1}
              >
                {word.hanzi}
              </h2>
              {word.partOfSpeech && (
                <p className="g-pos">{word.partOfSpeech}</p>
              )}
              {word.meaning && <p className="g-vi">{word.meaning}</p>}
            </section>
          )}

          {step.kind === 'example' && word.example && (
            <>
              <p className="g-kicker">Câu ví dụ</p>
              <section
                className="g-ex"
                aria-label={`Câu ví dụ với ${word.hanzi}`}
                ref={(node) => {
                  headingRef.current = node;
                }}
                tabIndex={-1}
              >
                <p className="g-ex__cn" lang="zh-Hans">
                  {markWord(word.example.hanzi, word.hanzi)}
                </p>
                {word.example.pinyin && (
                  <p className="g-ex__py" lang="zh-Latn-pinyin">
                    {word.example.pinyin}
                  </p>
                )}
                {word.example.vi && (
                  <p className="g-ex__vi">{word.example.vi}</p>
                )}
                {available && (
                  <div className="g-listen">
                    <button
                      className="g-say"
                      type="button"
                      onClick={() => speak(sayText, SPEECH_RATE)}
                    >
                      <Icon name="volume" />
                      Nghe câu
                    </button>
                    <button
                      className="g-say g-say--slow"
                      type="button"
                      onClick={() => speak(sayText, SPEECH_RATE_SLOW)}
                    >
                      <Icon name="volume" />
                      Nghe chậm
                    </button>
                  </div>
                )}
              </section>
            </>
          )}

          {step.kind === 'quiz' && (
            <>
              <h2
                className="g-q"
                id="lu-q"
                ref={(node) => {
                  headingRef.current = node;
                }}
                tabIndex={-1}
              >
                Chọn nghĩa đúng của <span className="cn">{head}</span>
              </h2>
              <p className="g-sub" lang="zh-Latn-pinyin">
                {word.pinyin}
              </p>
              <div className="g-opts" role="radiogroup" aria-labelledby="lu-q">
                {step.options.map((option, optionIndex) => {
                  const isPicked = selected === optionIndex;
                  const mark = checked
                    ? optionIndex === step.answer
                      ? 'is-right'
                      : isPicked
                        ? 'is-wrong'
                        : ''
                    : '';
                  return (
                    <button
                      key={option}
                      className={['g-opt', mark].filter(Boolean).join(' ')}
                      type="button"
                      role="radio"
                      aria-checked={isPicked}
                      aria-disabled={checked ? 'true' : undefined}
                      tabIndex={
                        (checked ? isPicked : optionIndex === focused) ? 0 : -1
                      }
                      onClick={() => choose(optionIndex)}
                      onKeyDown={(event) =>
                        radio.handleKeyDown(event, optionIndex)
                      }
                    >
                      <span>{option}</span>
                      {mark && (
                        <Icon
                          name={
                            mark === 'is-right' ? 'check-circle' : 'x-circle'
                          }
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </main>

      {step.kind === 'quiz' ? (
        checked && (
          <footer className="ex-foot g-wfoot">
            <div className={`g-fb ${correct ? 'is-ok' : 'is-bad'}`}>
              <Icon name={correct ? 'check-circle' : 'x-circle'} />
              <div className="grow">
                <p className="g-fb__title">
                  {correct
                    ? PLAYER_MESSAGES.correctTitle
                    : PLAYER_MESSAGES.wrongTitle}
                </p>
                <p className="g-fb__text">
                  {correct ? (
                    <>
                      {head} {word.pinyin} nghĩa là {meaning}.
                    </>
                  ) : (
                    <>
                      Đáp án đúng: {head} {word.pinyin} là {meaning}.
                    </>
                  )}
                </p>
              </div>
              <button
                className="g-btn"
                type="button"
                ref={continueRef}
                onClick={() => go(index + 1)}
              >
                Tiếp tục
              </button>
            </div>
          </footer>
        )
      ) : (
        <footer className="ex-foot g-wfoot">
          <PracticeBar
            key={index}
            hanzi={sayText}
            pinyin={
              step.kind === 'example' && word.example
                ? word.example.pinyin
                : word.pinyin
            }
            length={step.kind === 'example' ? 'sentence' : 'word'}
            voice={available}
            speak={speak}
            onNext={() => go(index + 1)}
            strokeCache={step.kind === 'card' ? strokeCache : undefined}
          />
        </footer>
      )}
    </div>
  );
}

type Save = 'idle' | 'saving' | 'saved' | 'failed';

/** mẫu unit-complete for Từ vựng: score, the words, Lưu để ôn. */
function VocabularyResult({
  lessonId,
  topicId,
  title,
  lessonHref,
  nextHref,
  words,
  steps,
  results,
}: Props & { results: Record<number, number> }) {
  const router = useRouter();
  const [save, setSave] = useState<Save>('idle');

  const saveAll = async () => {
    if (save === 'saving' || save === 'saved') return;
    setSave('saving');
    for (const word of words) {
      const response = await fetch(
        `/api/learner/dictionary/words/${word.id}/save`,
        { method: 'POST' },
      ).catch(() => null);
      if (response?.status === 401) {
        router.replace('/sign-in');
        return;
      }
      if (!response?.ok) {
        setSave('failed');
        return;
      }
    }
    setSave('saved');
  };

  const quizzes = steps.filter((step) => step.kind === 'quiz').length;
  const right = Object.values(results).filter((wrong) => wrong === 0).length;
  const score = quizzes > 0 ? Math.round((right / quizzes) * 100) : null;

  return (
    <UnitResult
      lessonId={lessonId}
      topicId={topicId}
      title={title}
      lessonHref={lessonHref}
      nextHref={nextHref}
      alerts={
        save === 'failed' && (
          <p className="ex-error lu-done__error" role="alert">
            Chưa lưu được. Bạn thử lại nhé.
          </p>
        )
      }
      actions={
        <button
          className="done-btn done-btn--light"
          type="button"
          aria-disabled={
            save === 'saved' || save === 'saving' ? 'true' : undefined
          }
          aria-busy={save === 'saving' || undefined}
          onClick={() => void saveAll()}
        >
          <Icon name={save === 'saved' ? 'bookmark-fill' : 'bookmark'} />
          {save === 'saved' ? 'Đã lưu để ôn' : 'Lưu để ôn'}
        </button>
      }
    >
      <div className="done-stats">
        {score !== null && (
          <section className="done-stat">
            <h2>Trả lời đúng</h2>
            <p
              className="done-stat__score"
              aria-label={`Trả lời đúng ${score}%`}
            >
              {score}
              <small>%</small>
            </p>
          </section>
        )}
        <section className="done-stat">
          <h2>Từ đã học</h2>
          <p className="done-stat__score">{words.length}</p>
        </section>
      </div>

      <h2 className="lu-h2">Từ vừa học</h2>
      <ul className="lu-words">
        {words.map((word, wordIndex) => {
          const mark = answerMark(results[wordIndex]);
          return (
            <li key={word.id}>
              <span className="hz" lang="zh-Hans">
                {word.hanzi}
              </span>
              <span className="py" lang="zh-Latn-pinyin">
                {word.pinyin}
              </span>
              <span className="vi">{word.firstMeaning ?? ''}</span>
              {mark && (
                <span className={`lu-mark ${mark.tone}`}>
                  <Icon
                    name={mark.tone === 'is-ok' ? 'check-circle' : 'x-circle'}
                    size={16}
                  />
                  {mark.text}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </UnitResult>
  );
}
