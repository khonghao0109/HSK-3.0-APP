import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LearnerLogoutButton } from '@/features/learner-auth/learner-logout-button';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { LearnerWebTopbar } from '@/features/learner-shell/learner-web-topbar';
import { getLearningHome } from '@/features/learner-home/learning-home-service';
import { getOptionalConsents } from '@/features/legal/legal-documents-service';
import { OptionalConsentSwitches } from '@/features/privacy/optional-consent-switches';
import { PrivacyRightsPanel } from '@/features/privacy/privacy-rights-panel';
import { isAuthFailure } from '@/lib/api/api-error';
import { redirectIfConsentRequired } from '@/lib/api/learner-session-failure';

export const metadata: Metadata = {
  title: 'Hồ sơ',
};

/**
 * Minimal profile until module 04/06 ships (Q17): name, email, sign out, and
 * "Quyền riêng tư & dữ liệu" (M1.7b2 B3: optional consents, PO 24/11; data
 * export and deletion, Q195; mẫu web/account-settings.html #privacy).
 */
export default async function LearnerProfilePage() {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }

  // Only the display name comes from /learning/home: any failure other than
  // a lost session still renders email and sign-out.
  let greetingName: string | null = null;
  let streakDays: number | null = null;
  let nameUnavailable = false;
  let authFailed = false;
  // Read together; any failure but a lost session only empties the switches.
  const optionalRead = getOptionalConsents(session.token).then(
    (state) => ({ state, error: null }),
    (error: unknown) => ({ state: null, error }),
  );
  try {
    const home = await getLearningHome(session.token);
    greetingName = home.greetingName;
    streakDays = home.streakDays;
  } catch (error) {
    redirectIfConsentRequired(error, '/learn/profile');
    if (isAuthFailure(error)) authFailed = true;
    else nameUnavailable = true;
  }

  const consents = await optionalRead;
  if (consents.error !== null) {
    redirectIfConsentRequired(consents.error, '/learn/profile');
    if (isAuthFailure(consents.error)) authFailed = true;
  }
  if (authFailed) {
    redirect('/sign-in');
  }

  return (
    <>
      <LearnerWebTopbar streakDays={streakDays} />
      <main className="profile">
        <h1 className="profile__title">Hồ sơ</h1>
        {/* Web hero card art (mẫu web/profile.html); no avatar API yet. */}
        <span className="profile__avatar w-only" aria-hidden="true">
          <svg className="icon">
            <use href="#i-user" />
          </svg>
        </span>
        <dl className="profile__card">
          <div className="profile__row">
            <dt>Tên</dt>
            <dd>
              {nameUnavailable
                ? 'Không tải được tên hiển thị.'
                : (greetingName ?? 'Chưa có tên hiển thị')}
            </dd>
          </div>
          <div className="profile__row">
            <dt>Email</dt>
            <dd>{session.user.email}</dd>
          </div>
        </dl>
        <LearnerLogoutButton />
        <section
          className="profile__privacy"
          aria-labelledby="profile-privacy-title"
        >
          <h2 className="profile__h2" id="profile-privacy-title">
            Quyền riêng tư &amp; dữ liệu
          </h2>
          <OptionalConsentSwitches initial={consents.state} />
          <div className="privacy-rights">
            <Link className="privacy-rights__link" href="/privacy">
              <svg className="icon" aria-hidden="true">
                <use href="#i-lock" />
              </svg>
              <span className="grow">
                <b>Quyền riêng tư</b>
                <small>Xem chính sách bảo mật</small>
              </span>
              <svg className="icon privacy-rights__chev" aria-hidden="true">
                <use href="#i-chevron-right" />
              </svg>
            </Link>
            <Link className="privacy-rights__link" href="/terms">
              <svg className="icon" aria-hidden="true">
                <use href="#i-file-text" />
              </svg>
              <span className="grow">
                <b>Điều khoản sử dụng</b>
                <small>Xem điều khoản sử dụng</small>
              </span>
              <svg className="icon privacy-rights__chev" aria-hidden="true">
                <use href="#i-chevron-right" />
              </svg>
            </Link>
          </div>
          <PrivacyRightsPanel variant="profile" />
        </section>
      </main>
    </>
  );
}
