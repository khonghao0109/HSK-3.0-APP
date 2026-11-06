import Link from 'next/link';

import {
  adminDateTime,
  questionChangedFieldLabel,
} from '@/features/admin-shell/admin-labels';

import type { QuestionDetail } from './question-contract';
import { questionActorLabel } from './question-values';

function changedLabel(revision: QuestionDetail['revisions'][number]): string {
  if (revision.revision === 1) return 'Tạo câu hỏi';
  if (revision.changedFields.length === 0) return '—';
  return revision.changedFields
    .map((field) => questionChangedFieldLabel(field))
    .join(', ');
}

function noteLabel(revision: QuestionDetail['revisions'][number]): string {
  return revision.reviews[0]?.note ?? '—';
}

/**
 * Khối "Lịch sử phiên bản" dưới bảng (TL-90): 5 cột Phiên bản / Thay đổi /
 * Bởi / Thời gian / Ghi chú + link "Mở câu hỏi".
 */
export function QuestionHistory({
  question,
  sessionAdminId,
}: {
  question: QuestionDetail;
  sessionAdminId: number;
}) {
  return (
    <section
      className="adm-card adm-panel qn-history"
      aria-labelledby="qn-history-title"
    >
      <div className="adm-panel__head qn-history__head">
        <h2 className="adm-panel__title" id="qn-history-title">
          Lịch sử phiên bản
        </h2>
        <Link className="adm-link" href={`/admin/questions/${question.id}`}>
          Mở câu hỏi
        </Link>
      </div>
      <div className="adm-table-wrap adm-table-wrap--swap">
        <table className="adm-table qn-history__table">
          <caption className="sr-only">
            Lịch sử phiên bản của câu hỏi {question.id}
          </caption>
          <thead>
            <tr>
              <th scope="col">Phiên bản</th>
              <th scope="col">Thay đổi</th>
              <th scope="col">Bởi</th>
              <th scope="col">Thời gian</th>
              <th scope="col">Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {question.revisions.map((revision) => (
              <tr key={revision.id}>
                <td>v{revision.revision}</td>
                <td>{changedLabel(revision)}</td>
                <td>{questionActorLabel(revision.author, sessionAdminId)}</td>
                <td>{adminDateTime(revision.createdAt)}</td>
                <td>{noteLabel(revision)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol
        className="adm-record-list adm-record-list--swap qn-history__list"
        aria-label={`Lịch sử phiên bản câu hỏi ${question.id} cho màn hẹp`}
      >
        {question.revisions.map((revision) => (
          <li key={revision.id}>
            <div className="adm-record-list__head">
              <strong>Phiên bản v{revision.revision}</strong>
              <span>{adminDateTime(revision.createdAt)}</span>
            </div>
            <dl className="adm-record-list__facts">
              <div>
                <dt>Thay đổi</dt>
                <dd>{changedLabel(revision)}</dd>
              </div>
              <div>
                <dt>Bởi</dt>
                <dd>{questionActorLabel(revision.author, sessionAdminId)}</dd>
              </div>
              <div>
                <dt>Ghi chú</dt>
                <dd>{noteLabel(revision)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}
