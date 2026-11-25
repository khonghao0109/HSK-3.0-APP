/**
 * M1.7b2 B2a: values the /consent page, its form and the learner banner share.
 * No Zod here: client components import this module (AGENTS.md).
 */
export type ConsentDocumentType = 'terms' | 'privacy';

/** A document the learner still has to accept (`blocked` or `pending`). */
export type ConsentDocumentView = {
  type: ConsentDocumentType;
  status: 'blocked' | 'pending';
  version: string;
  sha256: string;
  effectiveAt: string;
  deadline: string | null;
};

export const CONSENT_DOCUMENT_LABELS: Record<
  ConsentDocumentType,
  { name: string; href: string }
> = {
  terms: { name: 'Điều khoản sử dụng', href: '/terms' },
  privacy: { name: 'Chính sách bảo mật', href: '/privacy' },
};

const CONSENT_DATE = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** `dd/mm/yyyy` in Vietnam time; the raw value if it is not a date. */
export function consentDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : CONSENT_DATE.format(date);
}

/** sessionStorage key of "Để sau": the deadline the learner postponed. */
export const CONSENT_LATER_KEY = 'hsk.consent.later';

/** Remembers "Để sau" for this tab; a blocked storage just loses it. */
export function rememberConsentLater(deadline: string): void {
  try {
    window.sessionStorage.setItem(CONSENT_LATER_KEY, deadline);
  } catch {
    // Storage unavailable (private mode, quota): the banner shows again.
  }
}

/** Whether "Để sau" was chosen in this tab for this exact deadline. */
export function consentLaterChosen(deadline: string): boolean {
  try {
    return window.sessionStorage.getItem(CONSENT_LATER_KEY) === deadline;
  } catch {
    return false;
  }
}
