import Link from 'next/link';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import { AdminIcon } from '@/features/admin-shell/admin-icon';
import {
  adminDateTime,
  difficultyLabel,
  levelLabel,
  questionStatusLabel,
  skillLabel,
} from '@/features/admin-shell/admin-labels';

import type { AdminQuestionListItem } from './question-contract';
import { withQuestionSelected, type QuestionQuery } from './question-query';

function revisionLabel(question: AdminQuestionListItem): string {
  const revision = question.latestRevision?.revision ?? question.version;
  return `v${revision}`;
}

/** Revision mới nhất chưa được publish trong khi câu đang published (TL-89). */
function hasPendingRevision(question: AdminQuestionListItem): boolean {
  return (
    question.status === 'published' &&
    question.latestRevision !== null &&
    question.latestRevision.revision > question.version
  );
}

export function QuestionTable({
  questions,
  query,
}: {
  questions: AdminQuestionListItem[];
  query: QuestionQuery;
}) {
  if (questions.length === 0) {
    return (
      <div className="adm-empty" role="status">
        <AdminIcon name="search" />
        <p>Không có câu hỏi nào khớp bộ lọc.</p>
        <Link
          className="adm-btn adm-btn--outline adm-btn--sm"
          href="/admin/questions"
        >
          Xoá lọc
        </Link>
      </div>
    );
  }
  return (
    <>
      <div className="adm-table-wrap adm-table-wrap--swap">
        <table className="adm-table qn-table">
          <caption className="sr-only">
            Danh sách câu hỏi, trang hiện tại
          </caption>
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Nội dung câu hỏi</th>
              <th scope="col">Kỹ năng</th>
              <th scope="col">HSK</th>
              <th scope="col">Độ khó</th>
              <th scope="col">Phiên bản</th>
              <th scope="col">Cập nhật</th>
              <th scope="col">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((question) => {
              const selected = query.selected === question.id;
              return (
                <tr
                  key={question.id}
                  aria-current={selected ? 'true' : undefined}
                  className={selected ? 'qn-row qn-row--selected' : 'qn-row'}
                >
                  <td>
                    <Link
                      className="adm-link qn-row__link"
                      href={withQuestionSelected(query, question.id)}
                      aria-label={`Chọn câu hỏi ${question.id}`}
                    >
                      Q{question.id}
                    </Link>
                  </td>
                  <td>
                    <Link
                      className="qn-cell-content"
                      href={withQuestionSelected(query, question.id)}
                      title={question.content}
                      tabIndex={-1}
                    >
                      {question.content}
                    </Link>
                  </td>
                  <td>{skillLabel(question.skill)}</td>
                  <td>{levelLabel(question.level.code)}</td>
                  <td>{difficultyLabel(question.difficulty)}</td>
                  <td>{revisionLabel(question)}</td>
                  <td>{adminDateTime(question.updatedAt)}</td>
                  <td>
                    <AdminBadge
                      status={question.status}
                      label={questionStatusLabel(question.status)}
                    />
                    {hasPendingRevision(question) ? (
                      <span className="qn-pending">Có bản sửa chờ duyệt</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ol
        className="adm-record-list adm-record-list--swap qn-record-list"
        aria-label="Danh sách câu hỏi cho màn hẹp"
      >
        {questions.map((question) => (
          <li
            key={question.id}
            aria-current={query.selected === question.id ? 'true' : undefined}
          >
            <div className="adm-record-list__head">
              <div>
                <span className="qn-record-list__id">Q{question.id}</span>{' '}
                <strong title={question.content}>{question.content}</strong>
              </div>
              <AdminBadge
                status={question.status}
                label={questionStatusLabel(question.status)}
              />
            </div>
            <dl className="adm-record-list__facts">
              <div>
                <dt>Kỹ năng</dt>
                <dd>{skillLabel(question.skill)}</dd>
              </div>
              <div>
                <dt>HSK</dt>
                <dd>{levelLabel(question.level.code)}</dd>
              </div>
              <div>
                <dt>Độ khó</dt>
                <dd>{difficultyLabel(question.difficulty)}</dd>
              </div>
              <div>
                <dt>Phiên bản</dt>
                <dd>{revisionLabel(question)}</dd>
              </div>
              <div>
                <dt>Cập nhật</dt>
                <dd>{adminDateTime(question.updatedAt)}</dd>
              </div>
            </dl>
            {hasPendingRevision(question) ? (
              <span className="qn-pending">Có bản sửa chờ duyệt</span>
            ) : null}
            <Link
              className="adm-link"
              href={withQuestionSelected(query, question.id)}
              aria-label={`Xem lịch sử câu hỏi ${question.id}`}
            >
              Xem lịch sử
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
