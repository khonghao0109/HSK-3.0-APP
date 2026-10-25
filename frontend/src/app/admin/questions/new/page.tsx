import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { QuestionCreateScreen } from '@/features/questions/question-create-screen';
import { loadQuestionFormOptions } from '@/features/questions/question-service';
import { emptyQuestionFormValue } from '@/features/questions/question-values';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../admin-questions.css';

export const metadata: Metadata = { title: 'Tạo câu hỏi' };

export default async function QuestionCreatePage() {
  let options;
  try {
    options = await loadQuestionFormOptions();
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401)
      redirectToSessionLogin();
    if (error instanceof BackendRequestError && error.status === 403)
      redirect('/forbidden');
    throw error;
  }
  return (
    <div className="adm-page-stack">
      <nav className="adm-breadcrumb" aria-label="Đường dẫn">
        <Link href="/admin/questions">Ngân hàng câu hỏi</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Tạo câu hỏi</span>
      </nav>
      <header className="adm-page-head">
        <div>
          <h1>Tạo câu hỏi</h1>
          <p>
            Câu hỏi mới ở trạng thái bản nháp, kèm phiên bản đầu tiên; xuất bản
            sau khi được duyệt.
          </p>
        </div>
      </header>
      <section className="adm-card adm-panel" aria-labelledby="qn-create-title">
        <div className="adm-panel__head">
          <h2 className="adm-panel__title" id="qn-create-title">
            Nội dung câu hỏi
          </h2>
        </div>
        <QuestionCreateScreen
          initial={emptyQuestionFormValue(options.levels[0]?.id ?? '')}
          levels={options.levels}
          tags={options.tags}
          audio={options.audio}
          image={options.image}
          submitPath="/api/admin/questions"
        />
      </section>
    </div>
  );
}
