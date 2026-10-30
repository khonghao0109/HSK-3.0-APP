import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AdminIcon } from '@/features/admin-shell/admin-icon';
import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import {
  loadLevels,
  loadSessionAdminId,
} from '@/features/content/content-service';
import { QuestionBankSidebar } from '@/features/questions/question-bank-sidebar';
import { QuestionFilters } from '@/features/questions/question-filters';
import { QuestionHistory } from '@/features/questions/question-history';
import { QuestionPagination } from '@/features/questions/question-pagination';
import {
  parseQuestionQuery,
  questionBankItems,
} from '@/features/questions/question-query';
import {
  loadQuestion,
  loadQuestionCounts,
  loadQuestionTags,
  loadQuestions,
} from '@/features/questions/question-service';
import { QuestionTable } from '@/features/questions/question-table';
import { BackendRequestError } from '@/lib/api/api-error';

import '../admin-questions.css';

export const metadata: Metadata = { title: 'Ngân hàng câu hỏi' };

export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseQuestionQuery(await searchParams);
  let result;
  let counts;
  let tags;
  let levels;
  let sessionAdminId: number;
  let selected = null;
  try {
    [result, counts, tags, levels, sessionAdminId] = await Promise.all([
      loadQuestions(query),
      loadQuestionCounts(),
      loadQuestionTags(),
      loadLevels(),
      loadSessionAdminId(),
    ]);
    if (query.selected !== undefined) {
      try {
        selected = await loadQuestion(query.selected);
      } catch (error) {
        // Câu đã bị xoá/không còn: bỏ khối lịch sử, danh sách vẫn hiện.
        if (!(error instanceof BackendRequestError && error.status === 404)) {
          throw error;
        }
      }
    }
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401)
      redirectToSessionLogin();
    // Layouts do not re-render on client navigation, so the admin layout's
    // role check can be stale; the backend's per-request 403 is authoritative.
    if (error instanceof BackendRequestError && error.status === 403)
      redirect('/forbidden');
    throw error;
  }
  const bank = questionBankItems(counts, query);
  return (
    <div className="adm-page-stack">
      <header className="adm-page-head">
        <div>
          <h1>Ngân hàng câu hỏi</h1>
          <p>
            Soạn, duyệt và xuất bản câu hỏi trắc nghiệm, đúng/sai, điền từ và
            sắp xếp câu.
          </p>
        </div>
        <div className="adm-page-head__actions">
          <Link
            className="adm-btn adm-btn--primary"
            href="/admin/questions/new"
          >
            <AdminIcon name="plus" className="adm-icon adm-icon--sm" />
            Tạo câu hỏi
          </Link>
        </div>
      </header>

      <QuestionFilters
        query={query}
        levels={levels.map((level) => ({ id: level.id, code: level.code }))}
        tags={tags}
      />

      <div className="qn-layout">
        <QuestionBankSidebar items={bank} />
        <div className="adm-card adm-card--clip qn-list-card">
          <QuestionTable questions={result.data} query={query} />
          <QuestionPagination
            query={query}
            total={result.meta.pagination.total}
            totalPages={result.meta.pagination.totalPages}
          />
        </div>
      </div>

      {selected ? (
        <QuestionHistory question={selected} sessionAdminId={sessionAdminId} />
      ) : null}
    </div>
  );
}
