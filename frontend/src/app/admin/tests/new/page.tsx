import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { loadTestLevels } from '@/features/tests/test-service';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../admin-tests-list.css';
import { TestCreateForm } from './test-create-form';

export const metadata: Metadata = { title: 'Tạo đề thi' };

/** Trang tạo đề thi (TL-107): server nạp cấp HSK, form là client component. */
export default async function TestCreatePage() {
  let levels;
  try {
    levels = await loadTestLevels();
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401)
      redirectToSessionLogin();
    if (error instanceof BackendRequestError && error.status === 403)
      redirect('/forbidden');
    throw error;
  }
  return (
    <div className="adm-page-stack">
      <Link className="adm-link tst-create__back" href="/admin/tests">
        Quay lại danh sách đề
      </Link>
      <header className="adm-page-head">
        <div>
          <h1>Tạo đề thi</h1>
          <p>
            Đề mới ở trạng thái bản nháp và chưa có phần nào; soạn cấu trúc đề ở
            bước tiếp theo rồi xuất bản khi đủ điều kiện.
          </p>
        </div>
      </header>
      <section
        className="adm-card adm-panel"
        aria-labelledby="tst-create-heading"
      >
        <div className="adm-panel__head">
          <h2 className="adm-panel__title" id="tst-create-heading">
            Thông tin đề thi
          </h2>
        </div>
        <TestCreateForm levels={levels} />
      </section>
    </div>
  );
}
