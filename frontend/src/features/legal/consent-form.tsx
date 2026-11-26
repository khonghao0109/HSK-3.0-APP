'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useId, useState, useSyncExternalStore } from 'react';

import { PrivacyRightsPanel } from '@/features/privacy/privacy-rights-panel';
import { consentHref } from '@/lib/api/learner-session-failure';

import {
  CONSENT_DOCUMENT_LABELS,
  consentDate,
  consentLaterChosen,
  rememberConsentLater,
  type ConsentDocumentView,
} from './consent-values';

/** Shield of the mockups (shared/js/icons.js `shield`); not in the sprite. */
export function ShieldIcon() {
  return (
    <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  );
}

const MESSAGES = {
  untick: 'Tick ô xác nhận để đồng ý.',
  outdated: 'Văn bản vừa được cập nhật. Tải lại trang để xem bản mới.',
  failed: 'Chưa lưu được lựa chọn. Thử lại sau ít phút.',
  network: 'Không kết nối được. Kiểm tra mạng rồi thử lại.',
} as const;

function agreementLabel(documents: readonly ConsentDocumentView[]): string {
  const parts = documents.map(
    (doc) =>
      `${CONSENT_DOCUMENT_LABELS[doc.type].name} phiên bản ${doc.version}`,
  );
  return `Tôi đã đọc và đồng ý ${parts.join(' và ')}.`;
}

function earliestDeadline(
  documents: readonly ConsentDocumentView[],
): string | null {
  return (
    documents
      .flatMap((doc) => (doc.deadline ? [doc.deadline] : []))
      .sort()[0] ?? null
  );
}

/**
 * Gate of `/consent` (mẫu `.uxb-gate` / `.uxa-consent-card`). `blocked`:
 * Đồng ý plus "Quyền của bạn" (export, deletion, sign-out; Q189, B2b).
 * `pending`: Đồng ý and "Để sau".
 */
export function ConsentForm({
  mode,
  documents,
  returnTo,
}: {
  mode: 'blocked' | 'pending';
  documents: readonly ConsentDocumentView[];
  returnTo: string;
}) {
  const router = useRouter();
  const checkboxId = useId();
  const [agreed, setAgreed] = useState(false);
  const [pending, setPending] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (pending) return;
    if (!agreed) {
      setHint(MESSAGES.untick);
      return;
    }
    setHint(null);
    setError(null);
    setPending(true);
    try {
      const response = await fetch('/api/learner/consents/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documents: documents.map(({ type, version, sha256 }) => ({
            type,
            version,
            sha256,
          })),
        }),
      });
      if (response.ok) {
        window.location.assign(returnTo);
        return;
      }
      if (response.status === 401) {
        router.replace('/sign-in');
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const kind =
        typeof body === 'object' && body !== null && 'error' in body
          ? (body as { error?: { kind?: unknown } }).error?.kind
          : undefined;
      setError(
        kind === 'legal_documents_outdated'
          ? MESSAGES.outdated
          : MESSAGES.failed,
      );
    } catch {
      setError(MESSAGES.network);
    }
    setPending(false);
  }

  function later() {
    const deadline = earliestDeadline(documents);
    if (deadline) rememberConsentLater(deadline);
    window.location.assign(returnTo);
  }

  return (
    <aside className="consent__gate" aria-labelledby="consent-agree-title">
      <h2 className="consent__h2" id="consent-agree-title">
        Đồng ý để tiếp tục sử dụng
      </h2>
      <div className="consent__check">
        <input
          type="checkbox"
          id={checkboxId}
          checked={agreed}
          onChange={(event) => {
            setAgreed(event.target.checked);
            if (event.target.checked) setHint(null);
          }}
        />
        <label htmlFor={checkboxId}>{agreementLabel(documents)}</label>
      </div>
      {error && (
        <div className="alert alert--error" role="alert">
          <svg className="icon icon--sm" aria-hidden="true">
            <use href="#i-alert-triangle" />
          </svg>
          <span>{error}</span>
        </div>
      )}
      <button
        type="button"
        className="btn btn--primary btn--block"
        aria-disabled={!agreed || pending}
        aria-busy={pending || undefined}
        onClick={accept}
      >
        {pending ? 'Đang lưu…' : 'Đồng ý và tiếp tục'}
      </button>
      {mode === 'pending' && (
        <button
          type="button"
          className="btn btn--outline btn--block"
          onClick={later}
        >
          Để sau
        </button>
      )}
      <p className="consent__fine" role="status">
        {hint ?? 'Nút Đồng ý chỉ bấm được khi bạn đã tick ô xác nhận ở trên.'}
      </p>
      {mode === 'blocked' && (
        <div className="consent__more">
          <PrivacyRightsPanel />
        </div>
      )}
    </aside>
  );
}

// The stored choice only changes through this tab's own "Để sau".
const noSubscription = () => () => {};

/**
 * `pending` banner of the learner frame: the proxy passes the earliest
 * deadline in a request header. "Để sau" hides it for this tab only.
 */
export function ConsentPendingBanner({ deadline }: { deadline: string }) {
  const pathname = usePathname();
  // sessionStorage is not readable on the server: hidden until hydrated.
  const postponed = useSyncExternalStore(
    noSubscription,
    () => consentLaterChosen(deadline),
    () => true,
  );
  const [dismissed, setDismissed] = useState(false);

  // Lesson screens are a focused full-screen flow; the banner waits outside.
  if (postponed || dismissed || pathname.startsWith('/learn/lessons/'))
    return null;
  return (
    <section className="consent-banner" aria-labelledby="consent-banner-title">
      <ShieldIcon />
      <p className="consent-banner__text">
        <b id="consent-banner-title">Điều khoản đã cập nhật</b>
        <span> Đồng ý trước ngày {consentDate(deadline)} để tiếp tục học.</span>
      </p>
      <Link
        className="btn btn--primary consent-banner__go"
        href={consentHref(pathname)}
      >
        Xem và đồng ý
      </Link>
      <button
        type="button"
        className="btn btn--outline consent-banner__later"
        onClick={() => {
          rememberConsentLater(deadline);
          setDismissed(true);
        }}
      >
        Để sau
      </button>
    </section>
  );
}
