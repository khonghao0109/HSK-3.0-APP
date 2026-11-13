import type { ReactNode, RefObject } from 'react';

import {
  PRE_SUBMIT_REVIEW_TIP,
  PRE_SUBMIT_REVIEW_TIP_LABEL,
  type PreSubmitReviewLegendKey,
  type PreSubmitReviewModel,
} from './exam-pre-submit-review-model';

/**
 * M4.5 B2c (Q225): the pre-submit review screen, rendered as a mode of the
 * exam-taking island (client state, no new route). It only renders the model:
 * question numbers, answered/flagged state and counts — never answer content,
 * correct answers or explanations. Q225: pressing a number goes back to that
 * question; the submit button reuses the existing confirm dialog.
 *
 * Status is icon + text everywhere (R14, not colour only): the summary and the
 * legend carry an icon and a label, each cell carries its state in the
 * `aria-label`, answered cells show a check glyph and unanswered cells a dash,
 * flagged cells show the bookmark glyph.
 */
const LEGEND_GLYPHS: Record<PreSubmitReviewLegendKey, ReactNode> = {
  answered: (
    <svg className="icon">
      <use href="#i-check" />
    </svg>
  ),
  unanswered: <i className="extr-legend__dash" />,
  flagged: (
    <svg className="icon">
      <use href="#i-bookmark-fill" />
    </svg>
  ),
};

export function ExamPreSubmitReview({
  model,
  locked,
  submitting,
  headingRef,
  onPick,
  onExit,
  onSubmit,
}: {
  model: PreSubmitReviewModel;
  locked: boolean;
  submitting: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onPick: (index: number) => void;
  onExit: () => void;
  onSubmit: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <section className="extr" aria-labelledby="extr-heading">
      <div className="extr-card">
        <ul className="extr-sum" aria-label="Tổng quan bài làm">
          <li className="extr-sum__item extr-sum__item--answered">
            <span
              className="extr-sum__ico extr-sum__ico--answered"
              aria-hidden="true"
            >
              <svg className="icon">
                <use href="#i-check" />
              </svg>
            </span>
            <span className="extr-sum__body">
              <span className="extr-sum__label">Đã trả lời</span>
              <b className="tabular">{model.summary.answered}</b>
            </span>
          </li>
          <li className="extr-sum__item extr-sum__item--unanswered">
            <span
              className="extr-sum__ico extr-sum__ico--unanswered"
              aria-hidden="true"
            />
            <span className="extr-sum__body">
              <span className="extr-sum__label">Chưa trả lời</span>
              <b className="tabular">{model.summary.unanswered}</b>
            </span>
          </li>
          <li className="extr-sum__item extr-sum__item--flagged">
            <span
              className="extr-sum__ico extr-sum__ico--flagged"
              aria-hidden="true"
            >
              <svg className="icon">
                <use href="#i-bookmark-fill" />
              </svg>
            </span>
            <span className="extr-sum__body">
              <span className="extr-sum__label">Đánh dấu</span>
              <b className="tabular">{model.summary.flagged}</b>
            </span>
          </li>
        </ul>

        <h2
          className="extr-heading"
          id="extr-heading"
          ref={headingRef}
          tabIndex={-1}
        >
          {model.heading}
        </h2>

        <ul className="extr-legend" aria-label="Chú thích trạng thái câu">
          {model.legend.map((item) => (
            <li
              key={item.key}
              className={`extr-legend__item extr-legend__item--${item.key}`}
            >
              <span
                className={`extr-legend__ico extr-legend__ico--${item.key}`}
                aria-hidden="true"
              >
                {LEGEND_GLYPHS[item.key]}
              </span>
              {item.label}
            </li>
          ))}
        </ul>

        {model.sections.map((section) => {
          const headingId = `extr-sec-${section.key}`;
          return (
            <section
              key={section.key}
              className="extr-section"
              aria-labelledby={headingId}
            >
              <h3 className="extr-section__title" id={headingId}>
                {section.title}
              </h3>
              <div
                className="extr-grid"
                role="group"
                aria-labelledby={headingId}
              >
                {section.cells.map((cell) => (
                  <button
                    key={cell.questionKey}
                    type="button"
                    className={`extr-cell${cell.answered ? ' is-done' : ''}${
                      cell.flagged ? ' is-flag' : ''
                    }${cell.current ? ' is-current' : ''}`}
                    aria-label={cell.label}
                    aria-current={cell.current ? 'true' : undefined}
                    onClick={() => {
                      onPick(cell.index);
                    }}
                  >
                    <span className="extr-cell__n tabular" aria-hidden="true">
                      {cell.number}
                    </span>
                    {cell.answered ? (
                      <svg className="icon extr-cell__state" aria-hidden="true">
                        <use href="#i-check" />
                      </svg>
                    ) : (
                      <i
                        className="extr-cell__state extr-cell__state--none"
                        aria-hidden="true"
                      />
                    )}
                    {cell.flagged ? (
                      <svg className="icon extr-cell__flag" aria-hidden="true">
                        <use href="#i-bookmark-fill" />
                      </svg>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>
          );
        })}

        <p className="extr-tip">
          <svg className="icon" aria-hidden="true">
            <use href="#i-info" />
          </svg>
          <span>
            <b>{PRE_SUBMIT_REVIEW_TIP_LABEL}</b> {PRE_SUBMIT_REVIEW_TIP}
          </span>
        </p>
      </div>

      <div className="extr-actions">
        <button
          type="button"
          className="btn btn--primary extr-actions__submit"
          disabled={locked || submitting}
          onClick={(event) => {
            onSubmit(event.currentTarget);
          }}
        >
          Nộp bài
        </button>
        <button
          type="button"
          className="btn btn--outline extr-actions__continue"
          onClick={onExit}
        >
          <svg className="icon" aria-hidden="true">
            <use href="#i-arrow-left" />
          </svg>
          Tiếp tục làm bài
        </button>
      </div>
    </section>
  );
}
