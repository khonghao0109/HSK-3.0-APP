'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/ui/icon';
import { percentClass } from '@/features/learner-home/percent';
import { useRadioGroup } from '@/features/onboarding/use-radio-group';

import { LessonImage } from './lesson-image';
import { PLAYER_MESSAGES } from './lesson-player';
import { UnitResult } from './unit-result';
import {
  answerMark,
  sentenceTokens,
  type UnitStep,
  type UnitWord,
} from './vocabulary-unit';

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

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('vi') + text.slice(1);
}

/**
 * Step-by-step Từ vựng unit (PO 20/11/2026, N3/N4/N8; mẫu vocab-card,
 * vocab-example, vocab-quiz, unit-complete). Frame of the player (`.ex`).
 */
export function VocabularyUnitFlow(props: Props) {
  const { lessonHref, title, words, steps } = props;
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  // Wrong answers per word index (Pha C debt 3b).
  const [results, setResults] = useState<Record<number, number>>({});
  const continueRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const step = steps[index];
  const options = step?.kind === 'quiz' ? step.options : [];
  const radio = useRadioGroup({
    items: options.map((_, optionIndex) => optionIndex),
    onChange: (value: number) => {
      if (!checked) setSelected(value);
    },
  });

  useEffect(() => {
    if (checked) continueRef.current?.focus();
  }, [checked]);
  useEffect(() => {
    // Focus follows the step after a click, not on first render.
    if (moved.current) headingRef.current?.focus();
  }, [index]);

  if (!step) {
    return <VocabularyResult {...props} results={results} />;
  }

  const go = (to: number) => {
    moved.current = true;
    setIndex(to);
    setSelected(null);
    setChecked(false);
  };
  const check = () => {
    if (step.kind !== 'quiz' || selected === null || checked) return;
    setChecked(true);
    setResults((previous) => ({
      ...previous,
      [step.word]:
        (previous[step.word] ?? 0) + (selected === step.answer ? 0 : 1),
    }));
  };

  const word = words[step.word];
  if (!word) return null;
  const total = steps.length;
  const shown = index + 1;
  const correct = step.kind === 'quiz' && checked && selected === step.answer;
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
  const head = <span lang="zh-Hans">{word.hanzi}</span>;

  return (
    <div className="ex lu-flow">
      <p className="sr-only" aria-live="polite">
        {step.kind === 'quiz' && checked
          ? correct
            ? PLAYER_MESSAGES.correctTitle
            : PLAYER_MESSAGES.wrongTitle
          : ''}
      </p>
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
        <p
          className="m02-bar__count"
          aria-label={`Bước ${shown} trên ${total}`}
        >
          {`${shown}/${total}`}
        </p>
      </header>

      <main className="m02-sheet ex-body">
        {/* mẫu mobile `.uxa-progress`: thanh + số bước bên cạnh. */}
        <div className="lu-progress m-only">
          {progress('progress')}
          <span className="lu-progress__count" aria-hidden="true">
            {`${shown}/${total}`}
          </span>
        </div>

        {step.kind === 'card' && (
          <section className="lu-card" aria-labelledby="lu-word">
            <div className="lu-head">
              <div>
                <h2
                  className="lu-hz"
                  id="lu-word"
                  lang="zh-Hans"
                  ref={headingRef}
                  tabIndex={-1}
                >
                  {word.hanzi}
                </h2>
                <p className="lu-py" lang="zh-Latn-pinyin">
                  {word.pinyin}
                </p>
              </div>
              {word.image && (
                <LessonImage
                  className="lu-img"
                  mediaId={word.image.id}
                  altText={word.image.altText}
                />
              )}
            </div>
            {word.partOfSpeech && (
              <p className="lu-pos">{capitalize(word.partOfSpeech)}</p>
            )}
            {word.meaning && <p className="lu-vi">{word.meaning}</p>}
          </section>
        )}

        {step.kind === 'example' && word.example && (
          <ExampleCard word={word} headingRef={headingRef} />
        )}

        {step.kind === 'quiz' && (
          <>
            <h2
              className="uxa-h2 lu-q"
              id="lu-q"
              ref={headingRef}
              tabIndex={-1}
            >
              Chọn nghĩa đúng của {head}
            </h2>
            <p className="lu-sub" lang="zh-Latn-pinyin">
              {word.pinyin}
            </p>
            <div className="lu-opts" role="radiogroup" aria-labelledby="lu-q">
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
                    className={['lu-opt', mark].filter(Boolean).join(' ')}
                    type="button"
                    role="radio"
                    aria-checked={isPicked}
                    aria-disabled={checked ? 'true' : undefined}
                    tabIndex={
                      isPicked || (selected === null && optionIndex === 0)
                        ? 0
                        : -1
                    }
                    onClick={() => {
                      if (!checked) setSelected(optionIndex);
                    }}
                    onKeyDown={(event) =>
                      radio.handleKeyDown(event, optionIndex)
                    }
                  >
                    <span>{option}</span>
                    {mark && (
                      <Icon
                        name={mark === 'is-right' ? 'check-circle' : 'x-circle'}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </main>

      <footer className="ex-foot">
        {step.kind === 'quiz' ? (
          <>
            <div>
              {checked && correct && (
                <div className="m02-feedback">
                  <Icon
                    name="check-circle"
                    className="m02-feedback__icon m02-feedback__icon--ok"
                  />
                  <div className="grow">
                    <p className="m02-feedback__title">
                      {PLAYER_MESSAGES.correctTitle}
                    </p>
                    <p className="m02-feedback__text">
                      {head} {word.pinyin} nghĩa là {spoken(word.meaning ?? '')}
                      .
                    </p>
                  </div>
                  <button
                    className="m02-feedback__btn"
                    type="button"
                    ref={continueRef}
                    onClick={() => go(index + 1)}
                  >
                    Tiếp tục
                  </button>
                </div>
              )}
              {checked && !correct && (
                <div className="m02-feedback m02-feedback--wrong">
                  <Icon name="x-circle" className="m02-feedback__icon" />
                  <div className="grow">
                    <p className="m02-feedback__title">
                      {PLAYER_MESSAGES.wrongTitle}
                    </p>
                    <p className="m02-feedback__text">
                      Đáp án đúng: {head} {word.pinyin} là{' '}
                      {spoken(word.meaning ?? '')}.
                    </p>
                  </div>
                  <button
                    className="m02-feedback__btn"
                    type="button"
                    ref={continueRef}
                    onClick={() => go(index + 1)}
                  >
                    Tiếp tục
                  </button>
                </div>
              )}
            </div>
            {!checked && (
              <button
                className="ex-check"
                type="button"
                aria-disabled={selected === null ? 'true' : undefined}
                onClick={check}
              >
                Kiểm tra
              </button>
            )}
          </>
        ) : (
          <div className="lu-foot">
            {step.kind === 'example' ? (
              <button
                className="btn btn--outline"
                type="button"
                onClick={() => go(index - 1)}
              >
                <Icon name="chevron-left" />
                Trước
              </button>
            ) : (
              <span />
            )}
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => go(index + 1)}
            >
              Tiếp
              <Icon name="arrow-right" />
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}

function ExampleCard({
  word,
  headingRef,
}: {
  word: UnitWord;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const example = word.example;
  if (!example) return null;
  const tokens = sentenceTokens(example.hanzi, example.pinyin, word.hanzi);
  return (
    <section className="lu-card" aria-labelledby="lu-ex">
      <div className="lu-head">
        <h2 className="uxa-h3" id="lu-ex" ref={headingRef} tabIndex={-1}>
          Câu ví dụ với <span lang="zh-Hans">{word.hanzi}</span>
        </h2>
      </div>
      {tokens ? (
        <p className="lu-sent" lang="zh-Hans" aria-label={example.hanzi}>
          {tokens.map((token, tokenIndex) => (
            <span
              key={tokenIndex}
              className={`lu-tok${token.target ? ' is-target' : ''}`}
              aria-hidden="true"
            >
              <span className="lu-tok__py" lang="zh-Latn-pinyin">
                {token.pinyin}
              </span>
              <span className="lu-tok__hz">{token.hanzi}</span>
            </span>
          ))}
        </p>
      ) : (
        <>
          <p className="lu-sent lu-sent--plain" lang="zh-Hans">
            {example.hanzi}
          </p>
          {example.pinyin && (
            <p className="lu-sent__py" lang="zh-Latn-pinyin">
              {example.pinyin}
            </p>
          )}
        </>
      )}
      {example.vi && <p className="lu-trans">{example.vi}</p>}
    </section>
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
