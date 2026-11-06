import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import {
  questionStatusLabel,
  levelLabel,
  skillLabel,
} from '@/features/admin-shell/admin-labels';
import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { parseRouteId } from '@/features/content/content-values';
import { loadSessionAdminId } from '@/features/content/content-service';
import { QuestionEditScreen } from '@/features/questions/question-edit-screen';
import { QuestionHistory } from '@/features/questions/question-history';
import {
  loadQuestion,
  loadQuestionFormOptions,
} from '@/features/questions/question-service';
import type { QuestionDetail } from '@/features/questions/question-contract';
import { questionPrefillFromRow } from '@/features/questions/question-values';
import { QuestionWorkflow } from '@/features/questions/question-workflow';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../admin-questions.css';
import '../../admin-exercise-form.css';

export const metadata: Metadata = { title: 'Câu hỏi' };

export default async function QuestionDetailPage({
  params,
}: {
  params: Promise<{ questionId: string }>;
}) {
  const questionId = parseRouteId((await params).questionId);
  if (questionId === null) notFound();
  let question: QuestionDetail;
  let sessionAdminId: number;
  let options;
  try {
    [question, sessionAdminId, options] = await Promise.all([
      loadQuestion(questionId),
      loadSessionAdminId(),
      loadQuestionFormOptions(),
    ]);
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401)
      redirectToSessionLogin();
    if (error instanceof BackendRequestError && error.status === 403)
      redirect('/forbidden');
    if (error instanceof BackendRequestError && error.status === 404)
      notFound();
    throw error;
  }
  const initial = questionPrefillFromRow(question);
  return (
    <div className="adm-page-stack">
      <nav className="adm-breadcrumb" aria-label="Đường dẫn">
        <Link href="/admin/questions">Ngân hàng câu hỏi</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Câu hỏi {question.id}</span>
      </nav>
      <header className="adm-page-head">
        <div>
          <h1 className="qn-detail__title">{question.content}</h1>
          <p>
            {skillLabel(question.skill)} · {levelLabel(question.level.code)} ·
            phiên bản v{question.version}
          </p>
        </div>
        <div className="adm-page-head__actions">
          <AdminBadge
            status={question.status}
            label={questionStatusLabel(question.status)}
          />
        </div>
      </header>

      <div className="adm-detail-grid">
        <div className="adm-page-stack">
          <section
            className="adm-card adm-panel"
            aria-labelledby="qn-form-title"
          >
            <div className="adm-panel__head">
              <h2 className="adm-panel__title" id="qn-form-title">
                Nội dung câu hỏi
              </h2>
            </div>
            <QuestionEditScreen
              initial={initial}
              levels={options.levels}
              tags={options.tags}
              audio={options.audio}
              image={options.image}
              submitPath={`/api/admin/questions/${question.id}/revisions`}
              archived={question.status === 'archived'}
            />
          </section>
        </div>
        <section
          className="adm-card adm-panel"
          aria-labelledby="qn-workflow-title"
        >
          <div className="adm-panel__head">
            <h2 className="adm-panel__title" id="qn-workflow-title">
              Quy trình xuất bản
            </h2>
          </div>
          <QuestionWorkflow
            question={question}
            sessionAdminId={sessionAdminId}
          />
        </section>
      </div>

      <QuestionHistory question={question} sessionAdminId={sessionAdminId} />
    </div>
  );
}
