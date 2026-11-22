'use client';

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Icon } from '@/components/ui/icon';
import { useRadioGroup } from '@/features/onboarding/use-radio-group';

import type { MatchingMove } from './lesson-player-model';
import { PLAYER_MESSAGES } from './lesson-player';
import { MatchingExercise } from './matching-exercise';
import { SPEECH_RATE, SPEECH_RATE_SLOW } from './speech';
import {
  type DrillChip,
  type DrillStep,
  arrangedRight,
} from './vocabulary-drills';

const NAMES: Record<DrillStep['kind'], string> = {
  match: 'Ghép từ với nghĩa',
  fill: 'Điền chỗ trống',
  arrange: 'Sắp xếp',
  listen: 'Nghe và sắp xếp',
};

type Props = {
  step: DrillStep;
  /** 1-based place among the drills of this unit, and their count. */
  place: number;
  count: number;
  /** Mobile progress row, shown at the top of `main` (mẫu `.uxa-progress`). */
  progress: ReactNode;
  headingRef: RefObject<HTMLElement | null>;
  speak: (text: string, rate?: number) => void;
  onNext: () => void;
};

/** Builds the drill screen: its `main`, then its footer. */
type Frame = (body: ReactNode, foot?: ReactNode) => ReactNode;

type Verdict = { right: boolean; title: string; text: ReactNode };

/**
 * Pha G2c (mẫu vu-matching, vu-fill, vu-arrange-vi, vu-listen-arrange): one
 * review drill at the end of a Từ vựng unit. Graded here, nothing is sent
 * (Q-G8). A choice is graded at once; arrange waits for Xác nhận (Q-G4). A
 * wrong answer shows the right one, then only Tiếp tục (Q-G9).
 */
export function VocabularyDrill(props: Props) {
  const { step, place, count, progress, headingRef, onNext } = props;
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const kicker = `Ôn tập ${place}/${count} · ${NAMES[step.kind]}`;

  useEffect(() => {
    if (verdict) continueRef.current?.focus();
  }, [verdict]);

  const setHeading = (node: HTMLElement | null) => {
    headingRef.current = node;
  };

  const verdictFoot = verdict && (
    <footer className="ex-foot g-wfoot">
      <div
        className={`g-fb ${
          verdict.right
            ? 'is-ok'
            : step.kind === 'match'
              ? 'is-neutral'
              : 'is-bad'
        }`}
      >
        <Icon
          name={
            verdict.right
              ? 'check-circle'
              : step.kind === 'match'
                ? 'check-circle-line'
                : 'x-circle'
          }
        />
        <div className="grow">
          <p className="g-fb__title">{verdict.title}</p>
          {verdict.text && <p className="g-fb__text">{verdict.text}</p>}
        </div>
        <button
          className="g-btn"
          type="button"
          ref={continueRef}
          onClick={onNext}
        >
          Tiếp tục
        </button>
      </div>
    </footer>
  );
  const frame: Frame = (body, foot) => (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {verdict && step.kind !== 'match'
          ? `${verdict.title}. ${verdict.right ? '' : 'Câu đúng: '}${step.sentence}`
          : ''}
      </p>
      <main className="m02-sheet ex-body">
        {progress}
        <div className="g-body">{body}</div>
      </main>
      {verdictFoot || foot}
    </>
  );

  if (step.kind === 'match') {
    return (
      <MatchDrill
        step={step}
        title={kicker}
        headingRef={headingRef}
        frame={frame}
        onDone={setVerdict}
      />
    );
  }
  if (step.kind === 'fill') {
    return (
      <FillDrill
        step={step}
        kicker={kicker}
        setHeading={setHeading}
        frame={frame}
        onDone={setVerdict}
      />
    );
  }
  return (
    <ArrangeDrill
      step={step}
      kicker={kicker}
      setHeading={setHeading}
      speak={props.speak}
      verdict={verdict}
      frame={frame}
      onDone={setVerdict}
    />
  );
}

const cn = (text: string) => <span lang="zh-Hans">{text}</span>;

function sentenceVerdict(right: boolean, sentence: string): Verdict {
  return right
    ? { right, title: PLAYER_MESSAGES.correctTitle, text: cn(sentence) }
    : {
        right,
        title: PLAYER_MESSAGES.wrongTitle,
        text: <>Câu đúng: {cn(sentence)}</>,
      };
}

function MatchDrill({
  step,
  title,
  headingRef,
  frame,
  onDone,
}: {
  step: Extract<DrillStep, { kind: 'match' }>;
  title: string;
  headingRef: RefObject<HTMLElement | null>;
  frame: Frame;
  onDone: (verdict: Verdict) => void;
}) {
  const [moves, setMoves] = useState<MatchingMove[]>([]);
  const ownHeading = useRef<HTMLHeadingElement>(null);
  // Runs before the flow's effect that focuses the heading of a new step.
  useEffect(() => {
    headingRef.current = ownHeading.current;
  }, [headingRef]);
  const locked = new Set(
    moves.filter((move) => move.leftId === move.rightId).map((m) => m.leftId),
  );
  const done = locked.size === step.pairs.length;

  return frame(
    <div className="g-match">
      <MatchingExercise
        prompt={title}
        pairs={step.pairs}
        rightOrder={step.rightOrder}
        moves={moves}
        locked={done}
        headingRef={ownHeading}
        onMove={(move) => {
          const next = [...moves, move];
          setMoves(next);
          const right = new Set(
            next.filter((m) => m.leftId === m.rightId).map((m) => m.leftId),
          );
          if (right.size < step.pairs.length) return;
          const mistakes = next.length - right.size;
          onDone(
            mistakes === 0
              ? {
                  right: true,
                  title: PLAYER_MESSAGES.correctTitle,
                  text: PLAYER_MESSAGES.matchingCorrectText(step.pairs.length),
                }
              : {
                  right: false,
                  title: PLAYER_MESSAGES.matchingDoneTitle(mistakes),
                  text: null,
                },
          );
        }}
      />
    </div>,
  );
}

function ChipFace({ chip }: { chip: DrillChip }) {
  return (
    <>
      <span className="g-chip__py" lang="zh-Latn-pinyin">
        {chip.pinyin}
      </span>
      <span lang="zh-Hans">{chip.hanzi}</span>
    </>
  );
}

function FillDrill({
  step,
  kicker,
  setHeading,
  frame,
  onDone,
}: {
  step: Extract<DrillStep, { kind: 'fill' }>;
  kicker: string;
  setHeading: (node: HTMLElement | null) => void;
  frame: Frame;
  onDone: (verdict: Verdict) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [focused, setFocused] = useState(0);
  const radio = useRadioGroup({
    items: step.options.map((_, index) => index),
    onChange: setFocused,
  });
  const checked = picked !== null;
  const chosen = checked ? step.options[picked] : undefined;

  const choose = (index: number) => {
    if (checked) return;
    setPicked(index);
    onDone(sentenceVerdict(index === step.answer, step.sentence));
  };

  return frame(
    <>
      <p className="g-kicker">{kicker}</p>
      <h2 className="g-q" id="lu-q" ref={setHeading} tabIndex={-1}>
        Chọn từ điền vào chỗ trống
      </h2>
      <p className="g-ex__cn g-fill" lang="zh-Hans">
        {step.before}
        <span
          className={`g-blank${checked && picked !== step.answer ? ' is-wrong' : ''}`}
          aria-label={chosen ? undefined : 'chỗ trống'}
        >
          {chosen ? chosen.hanzi : ' '}
        </span>
        {step.after}
      </p>
      {step.vi && <p className="g-sub">{step.vi}</p>}
      <div
        className="g-opts g-opts--chips"
        role="radiogroup"
        aria-labelledby="lu-q"
      >
        {step.options.map((option, index) => {
          const mark = checked
            ? index === step.answer
              ? 'is-right'
              : index === picked
                ? 'is-wrong'
                : ''
            : '';
          return (
            <button
              key={option.hanzi}
              className={['g-opt', mark].filter(Boolean).join(' ')}
              type="button"
              role="radio"
              aria-checked={index === picked}
              aria-disabled={checked ? 'true' : undefined}
              tabIndex={
                (checked ? index === picked : index === focused) ? 0 : -1
              }
              onClick={() => choose(index)}
              onKeyDown={(event) => radio.handleKeyDown(event, index)}
            >
              <ChipFace chip={option} />
            </button>
          );
        })}
      </div>
    </>,
  );
}

function ArrangeDrill({
  step,
  kicker,
  setHeading,
  speak,
  verdict,
  frame,
  onDone,
}: {
  step: Extract<DrillStep, { kind: 'arrange' | 'listen' }>;
  kicker: string;
  setHeading: (node: HTMLElement | null) => void;
  speak: (text: string, rate?: number) => void;
  verdict: Verdict | null;
  frame: Frame;
  onDone: (verdict: Verdict) => void;
}) {
  // Chip indexes in the order the learner placed them.
  const [placed, setPlaced] = useState<number[]>([]);
  const left = step.chips.length - placed.length;
  const checked = verdict !== null;
  const listen = step.kind === 'listen';

  const confirm = () => {
    if (left > 0 || checked) return;
    onDone(sentenceVerdict(arrangedRight(step.chips, placed), step.sentence));
  };

  return frame(
    <>
      <p className="g-kicker">{kicker}</p>
      <h2 className="g-q" id="lu-q" ref={setHeading} tabIndex={-1}>
        {listen ? 'Nghe rồi xếp lại câu' : 'Xếp thành câu tiếng Trung'}
      </h2>
      {listen ? (
        <div className="g-listen">
          <button
            className="g-listen__big"
            type="button"
            aria-label="Nghe câu"
            onClick={() => speak(step.sentence, SPEECH_RATE)}
          >
            <Icon name="volume" />
          </button>
          <button
            className="g-say g-say--slow"
            type="button"
            onClick={() => speak(step.sentence, SPEECH_RATE_SLOW)}
          >
            Nghe chậm
          </button>
        </div>
      ) : (
        <p className="g-prompt">{step.vi}</p>
      )}
      <div>
        <div
          className={`g-answer${checked ? (verdict.right ? ' is-ok' : ' is-bad') : ''}`}
          role="group"
          aria-label="Câu bạn ghép"
        >
          {placed.length === 0 ? (
            <p className="g-answer__empty">Chạm vào các mảnh bên dưới</p>
          ) : (
            placed.map((chipIndex, place) => {
              const chip = step.chips[chipIndex];
              if (!chip) return null;
              return (
                <button
                  key={chipIndex}
                  className="g-tok"
                  type="button"
                  aria-label={checked ? chip.hanzi : `Bỏ ${chip.hanzi}`}
                  aria-disabled={checked ? 'true' : undefined}
                  onClick={() => {
                    if (checked) return;
                    setPlaced(placed.filter((_, at) => at !== place));
                  }}
                >
                  <ChipFace chip={chip} />
                </button>
              );
            })
          )}
        </div>
        <div className="g-bank" role="group" aria-label="Các mảnh để chọn">
          {step.bank.map((chipIndex) => {
            const chip = step.chips[chipIndex];
            if (!chip) return null;
            const used = placed.includes(chipIndex);
            return (
              <button
                key={chipIndex}
                className={`g-tok${used ? ' is-used' : ''}`}
                type="button"
                aria-label={`Thêm ${chip.hanzi}`}
                aria-hidden={used || undefined}
                tabIndex={used ? -1 : undefined}
                aria-disabled={checked ? 'true' : undefined}
                onClick={() => {
                  if (used || checked) return;
                  setPlaced([...placed, chipIndex]);
                }}
              >
                <ChipFace chip={chip} />
              </button>
            );
          })}
        </div>
      </div>
      {listen && checked && (
        <p className="g-reveal">
          <span lang="zh-Latn-pinyin">{step.pinyin}</span>
          {step.vi ? ` ${step.vi}` : ''}
        </p>
      )}
    </>,
    <ArrangeFoot left={left} onConfirm={confirm} />,
  );
}

/** mẫu `#g-checkrow`: chips left, then Xác nhận (Q-G4). */
function ArrangeFoot({
  left,
  onConfirm,
}: {
  left: number;
  onConfirm: () => void;
}) {
  return (
    <footer className="ex-foot g-wfoot">
      <div className="g-row">
        <p className="g-note">
          <span>
            Còn <b>{left}</b> mảnh. Xếp đủ rồi bấm Xác nhận.
          </span>
        </p>
        <button
          className="g-btn"
          type="button"
          disabled={left > 0}
          onClick={onConfirm}
        >
          Xác nhận
        </button>
      </div>
    </footer>
  );
}
