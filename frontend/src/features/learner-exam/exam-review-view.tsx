import Link from 'next/link';

import type {
  ExamReviewMediaParsed,
  ExamReviewQuestionParsed,
  ExamReviewViewParsed,
} from './exam-contract';
import { ExamReviewMedia } from './exam-review-media';
import {
  correctAnswerText,
  filterQuestions,
  groupReviewQuestions,
  learnerAnswerText,
  mcqOptions,
  questionStatus,
  reviewFilterHref,
  REVIEW_EMPTY_FILTER_TEXT,
  REVIEW_FILTERS,
  REVIEW_FLAG_ICON,
  REVIEW_FLAG_LABEL,
  REVIEW_STATUS_ICONS,
  REVIEW_STATUS_LABELS,
  REVIEW_SUMMARY_LABELS,
  reviewSummary,
  type ReviewFilter,
  type ReviewStatus,
} from './exam-review-model';

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

function Summary({ questions }: { questions: ExamReviewQuestionParsed[] }) {
  const summary = reviewSummary(questions);
  return (
    <section className="exv-summary" aria-label="Tổng quan bài làm">
      <ul className="exv-sum">
        <li className="exv-sum__item">
          <span className="exv-sum__icon">
            <Icon name="check" />
          </span>
          <b>{summary.answered}</b>
          <small>{REVIEW_SUMMARY_LABELS.answered}</small>
        </li>
        <li className="exv-sum__item">
          <span className="exv-sum__icon">
            <Icon name="circle" />
          </span>
          <b>{summary.blank}</b>
          <small>{REVIEW_SUMMARY_LABELS.blank}</small>
        </li>
        <li className="exv-sum__item exv-sum__item--flag">
          <span className="exv-sum__icon">
            <Icon name={REVIEW_FLAG_ICON} />
          </span>
          <b>{summary.flagged}</b>
          <small>{REVIEW_SUMMARY_LABELS.flagged}</small>
        </li>
        <li className="exv-sum__item exv-sum__item--wrong">
          <span className="exv-sum__icon">
            <Icon name="x" />
          </span>
          <b>{summary.wrong}</b>
          <small>{REVIEW_SUMMARY_LABELS.wrong}</small>
        </li>
      </ul>
    </section>
  );
}

function FilterLinks({
  attemptId,
  filter,
  questions,
}: {
  attemptId: number;
  filter: ReviewFilter;
  questions: ExamReviewQuestionParsed[];
}) {
  const summary = reviewSummary(questions);
  const counts: Record<ReviewFilter, number> = {
    all: summary.total,
    correct: summary.correct,
    wrong: summary.wrong,
    flagged: summary.flagged,
  };
  return (
    <div className="exv-filters" role="group" aria-label="Lọc câu theo kết quả">
      {REVIEW_FILTERS.map((item) => (
        <Link
          className="exv-filter"
          href={reviewFilterHref(attemptId, item.value)}
          aria-current={filter === item.value ? 'page' : undefined}
          key={item.value}
        >
          {item.label}
          <span className="exv-filter__count">{counts[item.value]}</span>
        </Link>
      ))}
    </div>
  );
}

function cellClass(question: ExamReviewQuestionParsed): string {
  const status = questionStatus(question);
  return `exv-cell exv-cell--${status}${
    question.isFlagged ? ' is-flagged' : ''
  }`;
}

function cellLabel(question: ExamReviewQuestionParsed): string {
  const status = REVIEW_STATUS_LABELS[questionStatus(question)];
  return `Câu ${String(question.orderIndex)}, ${status}${
    question.isFlagged ? ', đánh dấu' : ''
  }`;
}

function cellGlyph(question: ExamReviewQuestionParsed): '✓' | '✕' | null {
  const status = questionStatus(question);
  if (status === 'correct') return '✓';
  if (status === 'wrong') return '✕';
  return null;
}

function QuestionGrid({
  questions,
}: {
  questions: ExamReviewQuestionParsed[];
}) {
  return (
    <nav className="exv-grid" aria-label="Danh sách câu hỏi">
      {questions.map((question) => {
        const glyph = cellGlyph(question);
        return (
          <a
            className={cellClass(question)}
            href={`#q-${String(question.orderIndex)}`}
            aria-label={cellLabel(question)}
            key={question.key}
          >
            <span>{question.orderIndex}</span>
            {glyph !== null ? (
              <span className="exv-cell__mark" aria-hidden="true">
                {glyph}
              </span>
            ) : null}
          </a>
        );
      })}
    </nav>
  );
}

function MediaBlock({
  attemptId,
  media,
  label,
}: {
  attemptId: number;
  media: ExamReviewMediaParsed;
  label: string;
}) {
  return (
    <div className="exv-media" role="group" aria-label={label}>
      <ExamReviewMedia
        attemptId={attemptId}
        mediaId={media.mediaId}
        kind={media.kind}
      />
    </div>
  );
}

function QuestionAnswers({ question }: { question: ExamReviewQuestionParsed }) {
  const status: ReviewStatus = questionStatus(question);
  const learner = learnerAnswerText(question);
  const correct = correctAnswerText(question);
  return (
    <>
      {question.type === 'mcq' ? (
        <ol className="exv-opts" aria-label="Các phương án">
          {mcqOptions(question).map((option) => (
            <li
              className={`exv-opt${option.isCorrect ? ' is-correct' : ''}${
                option.isChosen ? ' is-chosen' : ''
              }`}
              key={option.id}
            >
              <span className="exv-opt__letter" aria-hidden="true">
                {option.letter}
              </span>
              <span>{option.text}</span>
              {option.isCorrect ? (
                <span className="exv-opt__mark">
                  <Icon name="check" />
                  Đáp án đúng
                </span>
              ) : null}
              {option.isChosen && !option.isCorrect ? (
                <span className="exv-opt__mark">
                  <Icon name="x" />
                  Bạn chọn
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <dl className="exv-ans">
        <dt>Bạn chọn</dt>
        <dd className={learner === '' ? 'is-empty' : undefined}>
          {status === 'blank' ? 'Chưa trả lời' : learner}
        </dd>
        <dt>Đáp án đúng</dt>
        <dd className="is-correct">{correct}</dd>
      </dl>
    </>
  );
}

function QuestionPanel({
  attemptId,
  question,
}: {
  attemptId: number;
  question: ExamReviewQuestionParsed;
}) {
  const status = questionStatus(question);
  return (
    <article
      className={`exv-q exv-q--${status}`}
      id={`q-${String(question.orderIndex)}`}
      aria-labelledby={`q-${String(question.orderIndex)}-title`}
    >
      <div className="exv-q__head">
        <p className="exv-kicker">
          Câu {question.orderIndex}
          <span className={`exv-status exv-status--${status}`}>
            <Icon name={REVIEW_STATUS_ICONS[status]} />
            {REVIEW_STATUS_LABELS[status]}
          </span>
        </p>
        {question.isFlagged ? (
          <span className="exv-flag">
            <Icon name={REVIEW_FLAG_ICON} />
            {REVIEW_FLAG_LABEL}
          </span>
        ) : null}
      </div>
      <h4
        className="exv-q__title"
        id={`q-${String(question.orderIndex)}-title`}
      >
        {question.content}
      </h4>
      <QuestionAnswers question={question} />
      {question.audio !== null ? (
        <MediaBlock
          attemptId={attemptId}
          media={question.audio}
          label={`Âm thanh câu ${String(question.orderIndex)}`}
        />
      ) : null}
      {question.image !== null ? (
        <MediaBlock
          attemptId={attemptId}
          media={question.image}
          label={`Hình ảnh câu ${String(question.orderIndex)}`}
        />
      ) : null}
      {question.explanation !== null ? (
        <div className="exv-ex">
          <b>Vì sao?</b> {question.explanation}
        </div>
      ) : null}
    </article>
  );
}

function GroupMedia({
  attemptId,
  media,
}: {
  attemptId: number;
  media: ExamReviewQuestionParsed['groupMedia'];
}) {
  if (media.audio === null && media.image === null) return null;
  return (
    <div className="exv-group__media">
      {media.audio !== null ? (
        <MediaBlock
          attemptId={attemptId}
          media={media.audio}
          label="Âm thanh của nhóm câu"
        />
      ) : null}
      {media.image !== null ? (
        <MediaBlock
          attemptId={attemptId}
          media={media.image}
          label="Hình ảnh của nhóm câu"
        />
      ) : null}
    </div>
  );
}

/**
 * M4.5 B2b: the server-rendered review body. The only interactive parts are
 * ordinary links (back/result/filter/anchor) and the media island; filtering is
 * a URL state, so the browser needs no review BFF route.
 */
export function ExamReviewView({
  review,
  filter,
}: {
  review: ExamReviewViewParsed;
  filter: ReviewFilter;
}) {
  const visible = filterQuestions(review.questions, filter);
  const sections = groupReviewQuestions(visible);
  const attemptId = review.attemptId;
  const resultHref = `/learn/exam/attempts/${String(attemptId)}/result`;

  return (
    <main className="ex exr exv">
      <header className="exr-bar w-only">
        <Link
          className="icon-btn"
          href={resultHref}
          aria-label="Quay lại kết quả bài thi"
        >
          <Icon name="arrow-left" />
        </Link>
        <h1 className="exr-bar__title">Xem lại bài thi</h1>
        <Link className="btn btn--primary exv-bar__cta" href={resultHref}>
          Xem kết quả
          <Icon name="arrow-right" />
        </Link>
      </header>
      <header className="exr-mbar m-only">
        <Link
          className="icon-btn"
          href={resultHref}
          aria-label="Quay lại kết quả bài thi"
        >
          <Icon name="arrow-left" />
        </Link>
        <h1 className="exr-mbar__title">Xem lại bài thi</h1>
        <span aria-hidden="true" className="exr-mbar__spacer" />
      </header>
      <div className="exr-body exv-body">
        <Summary questions={review.questions} />
        <div className="exv-layout">
          <aside className="exv-side" aria-labelledby="exv-grid-title">
            <h2 className="exv-h2" id="exv-grid-title">
              Chọn câu hỏi để xem lại
            </h2>
            <FilterLinks
              attemptId={attemptId}
              filter={filter}
              questions={review.questions}
            />
            <QuestionGrid questions={visible} />
            <p className="exv-fine">
              <Icon name="info" />
              Chạm vào số câu để xem đáp án bạn chọn, đáp án đúng và giải thích.
            </p>
          </aside>
          <div className="exv-main">
            {visible.length === 0 ? (
              <p className="exv-empty">{REVIEW_EMPTY_FILTER_TEXT[filter]}</p>
            ) : (
              sections.map((section) => (
                <section
                  className="exv-section"
                  aria-labelledby={`sec-${section.key}`}
                  key={section.key}
                >
                  <h2 className="exv-section__title" id={`sec-${section.key}`}>
                    {section.title}
                  </h2>
                  {section.groups.map((group) => (
                    <div className="exv-group" key={group.key}>
                      <h3 className="exv-h3">{group.label}</h3>
                      <GroupMedia attemptId={attemptId} media={group.media} />
                      {group.questions.map((question) => (
                        <QuestionPanel
                          attemptId={attemptId}
                          question={question}
                          key={question.key}
                        />
                      ))}
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
