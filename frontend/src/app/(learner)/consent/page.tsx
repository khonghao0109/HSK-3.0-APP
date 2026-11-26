import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { LearnerBrand } from '@/features/learner-shell/learner-brand';
import { LearnerPublicFooter } from '@/features/learner-shell/learner-public-footer';
import { ConsentForm, ShieldIcon } from '@/features/legal/consent-form';
import { PrivacyRightsPanel } from '@/features/privacy/privacy-rights-panel';
import {
  CONSENT_DOCUMENT_LABELS,
  consentDate,
  type ConsentDocumentView,
} from '@/features/legal/consent-values';
import { getUserConsents } from '@/features/legal/legal-documents-service';
import { safeReturnTo } from '@/lib/api/learner-session-failure';

export const metadata: Metadata = {
  title: 'Điều khoản & quyền riêng tư',
};

/**
 * `/consent` (M1.7b2 B2a; mẫu web/consent.html, mobile/consent.html). The
 * proxy sends a `blocked` learner here; a `pending` one comes from the
 * banner. TL bỏ "3 điểm thay đổi chính" và dòng phiên bản tĩnh: mỗi văn bản
 * hiện loại, phiên bản, ngày hiệu lực và link tới trang của nó.
 *
 * One DOM for both widths: the web nav and footer are `.w-only`, the mobile
 * appbar `.m-only` (one `<main>`, as `learner-a11y.spec.ts` counts it).
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;
  const target = safeReturnTo(typeof returnTo === 'string' ? returnTo : null);
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) redirect('/sign-in');

  const consents = await getUserConsents(session.token);
  const documents: ConsentDocumentView[] = consents.flatMap((doc) =>
    (doc.status === 'blocked' || doc.status === 'pending') &&
    doc.version &&
    doc.sha256 &&
    doc.effectiveAt
      ? [
          {
            type: doc.type,
            status: doc.status,
            version: doc.version,
            sha256: doc.sha256,
            effectiveAt: doc.effectiveAt,
            deadline: doc.deadline,
          },
        ]
      : [],
  );
  // A blocked document without a version to accept: going back to `target`
  // would only bring the proxy back here, so say so in place.
  const unusable = consents.some(
    (doc) =>
      doc.status === 'blocked' &&
      !documents.some((shown) => shown.type === doc.type),
  );
  if (!unusable && documents.length === 0) redirect(target);
  const mode = documents.some((doc) => doc.status === 'blocked')
    ? 'blocked'
    : 'pending';

  return (
    <div className="w-public consent-page">
      <header className="w-pubnav w-only">
        <LearnerBrand href="/" />
      </header>
      <div className="app">
        <header className="appbar m-only">
          <span></span>
          <span className="appbar__title">Điều khoản &amp; quyền riêng tư</span>
          <span></span>
        </header>
        <main className="consent">
          <div className="consent__main">
            <p className="consent__kicker">
              <ShieldIcon />
              Cập nhật chính sách
            </p>
            <h1 className="consent__title">Chúng tôi đã cập nhật điều khoản</h1>
            <section
              className="consent__card"
              aria-labelledby="consent-docs-title"
            >
              <h2 className="consent__h2" id="consent-docs-title">
                Văn bản cần đồng ý
              </h2>
              <ul className="consent__docs">
                {documents.map((doc) => {
                  const label = CONSENT_DOCUMENT_LABELS[doc.type];
                  return (
                    <li className="consent__doc" key={doc.type}>
                      <b>{label.name}</b>
                      <span className="consent__meta">
                        Phiên bản {doc.version}
                        <span aria-hidden="true"> · </span>
                        Hiệu lực {consentDate(doc.effectiveAt)}
                      </span>
                      {doc.status === 'pending' && doc.deadline && (
                        <span className="consent__meta">
                          Hạn đồng ý {consentDate(doc.deadline)}
                        </span>
                      )}
                      <Link className="link" href={label.href}>
                        Đọc {label.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
          {unusable ? (
            <aside className="consent__gate">
              <div className="alert alert--error" role="alert">
                <svg className="icon icon--sm" aria-hidden="true">
                  <use href="#i-alert-triangle" />
                </svg>
                <span>
                  Chưa tải được văn bản cần đồng ý. Thử lại sau ít phút.
                </span>
              </div>
              <div className="consent__more">
                <PrivacyRightsPanel />
              </div>
            </aside>
          ) : (
            <ConsentForm mode={mode} documents={documents} returnTo={target} />
          )}
        </main>
      </div>
      <LearnerPublicFooter />
    </div>
  );
}
