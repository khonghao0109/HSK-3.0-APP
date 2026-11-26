import { Fragment, type Ref } from 'react';

import {
  type DialogueLine,
  exampleParts,
  type GrammarPointBlock,
  speakerInitial,
  speakerTones,
} from './topic-content';
import { WordAudioButton } from './word-audio-button';

/**
 * Pha D: the grammar point card and the conversation of `Topic.content`,
 * shared by the unit screens and the review page. No hooks, so server pages
 * and client flows both render it. CMS text is data: React text only.
 */

// A run of Han characters with the CJK punctuation that follows it.
const HAN_RUN = /(\p{Script=Han}[\p{Script=Han}　-〿＀-￯]*)/u;

/** Vietnamese text whose Chinese runs get `lang="zh-Hans"` (font, speech). */
export function ZhText({ text }: { text: string }) {
  return (
    <>
      {text.split(HAN_RUN).map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} lang="zh-Hans">
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const CHIP_CLASS: Record<GrammarPointBlock['formula'][number]['role'], string> =
  {
    subj: 'lu-chip is-subj',
    verb: 'lu-chip is-verb',
    key: 'lu-chip is-key',
    mw: 'lu-chip is-mw',
    other: 'lu-chip',
  };

/** mẫu grammar-point: title, formula chips (ZH + VI, N6), text, examples. */
export function GrammarPointBody({
  block,
  headingId,
  headingLevel: Heading = 'h2',
  headingRef,
}: {
  block: GrammarPointBlock;
  headingId: string;
  /** h3 under a topic heading on the review page. */
  headingLevel?: 'h2' | 'h3';
  /** The unit flow moves focus to the heading of the next card. */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <>
      <Heading
        className="uxa-h2"
        id={headingId}
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
      >
        <ZhText text={block.title} />
      </Heading>
      <ul className="lu-chips" aria-label="Công thức">
        {block.formula.map((chip, index) => (
          <li key={index} className={CHIP_CLASS[chip.role]}>
            <span lang="zh-Hans">{chip.zh}</span>
            <small>{chip.vi}</small>
          </li>
        ))}
      </ul>
      <p className="lu-desc">
        <ZhText text={block.explanation} />
      </p>
      {block.examples.map((example, index) => {
        const parts = exampleParts(example.hanzi, example.highlight);
        return (
          <div key={index} className="uxa-gram__ex">
            <p className="uxa-gram__excn" lang="zh-Hans">
              {parts ? (
                <>
                  {parts.before}
                  <mark className="lu-hl">{parts.mark}</mark>
                  {parts.after}
                </>
              ) : (
                example.hanzi
              )}
            </p>
            <p className="lu-line__py" lang="zh-Latn-pinyin">
              {example.pinyin}
            </p>
            <p className="uxa-gram__exvi">{example.vi}</p>
          </div>
        );
      })}
    </>
  );
}

export const KEY_TEXT_AUDIO_LABEL = 'Nghe bài khoá';

/**
 * mẫu key-text: one row per turn, the speaker as an initial (N7). M2.13d: the
 * audio of the whole key text sits in the first turn's cell (`lu-say`); the
 * other cells stay empty, since seeddata has no per-turn audio.
 */
export function DialogueLines({
  lines,
  audio,
}: {
  lines: readonly DialogueLine[];
  audio?: { mediaId: number };
}) {
  const tones = speakerTones(lines.map((line) => line.speaker));
  return (
    <ol className="lu-dlg">
      {lines.map((line, index) => (
        <li key={index} className={`lu-line ${tones.get(line.speaker)}`}>
          <span className="lu-line__who" role="img" aria-label={line.speaker}>
            {speakerInitial(line.speaker)}
          </span>
          <div className="lu-line__body">
            <p className="lu-line__cn" lang="zh-Hans">
              {line.hanzi}
            </p>
            <p className="lu-line__py" lang="zh-Latn-pinyin">
              {line.pinyin}
            </p>
            <p className="lu-line__vi">{line.vi}</p>
          </div>
          {index === 0 && audio ? (
            <span>
              <WordAudioButton
                audio={audio}
                label={KEY_TEXT_AUDIO_LABEL}
                className="lu-say"
              />
            </span>
          ) : (
            // mẫu: no audio, an empty cell keeps the rows aligned.
            <span className="lu-line__noaudio" aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}
