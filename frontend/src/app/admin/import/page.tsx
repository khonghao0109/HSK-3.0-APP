import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { ExerciseImportScreen } from '@/features/exercise-import/exercise-import-screen';
import { loadDataSources } from '@/features/exercise-import/exercise-import-service';
import { BackendRequestError } from '@/lib/api/api-error';

import '../admin-import.css';

export const metadata: Metadata = { title: 'Nhập dữ liệu' };

/**
 * M5.1b2 (TL-29/TL-33) — trang Nhập dữ liệu bài tập JSON. Server Component đọc
 * danh sách nguồn dữ liệu (Q97) rồi giao màn nhập cho client component; layout
 * admin không render lại khi điều hướng client nên trang tự map 401/403.
 */
export default async function ImportPage() {
  let sources;
  try {
    sources = await loadDataSources();
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401) {
      redirectToSessionLogin();
    }
    if (error instanceof BackendRequestError && error.status === 403) {
      redirect('/forbidden');
    }
    throw error;
  }
  return (
    <div className="adm-page-stack">
      <ExerciseImportScreen dataSources={sources.data} />
    </div>
  );
}
