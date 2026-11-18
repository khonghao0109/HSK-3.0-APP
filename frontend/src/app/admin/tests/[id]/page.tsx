import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { TestBuilderScreen } from '@/features/tests/test-builder-screen';
import { loadTest, loadTestFormOptions } from '@/features/tests/test-service';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../admin-tests.css';

export const metadata: Metadata = { title: 'Trình xây dựng đề thi' };

/**
 * `/admin/tests/[id]` (TL-108, Q115): bảng câu hỏi bên trái, panel
 * "Trình xây dựng đề thi" bên phải. Trang tách khỏi Ngân hàng câu hỏi.
 */
export default async function TestBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[1-9]\d{0,9}$/u.test(id) || Number(id) > 2_147_483_647) {
    notFound();
  }
  let test;
  let options;
  try {
    [test, options] = await Promise.all([
      loadTest(Number(id)),
      loadTestFormOptions(),
    ]);
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401) {
      redirectToSessionLogin();
    }
    if (error instanceof BackendRequestError && error.status === 403) {
      redirect('/forbidden');
    }
    if (error instanceof BackendRequestError && error.status === 404) {
      notFound();
    }
    throw error;
  }
  return <TestBuilderScreen initialTest={test} options={options} />;
}
