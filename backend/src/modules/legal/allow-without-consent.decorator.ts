import { SetMetadata } from '@nestjs/common';

export const ALLOW_WITHOUT_CONSENT_KEY = 'allowWithoutConsent';

/**
 * M1.7b2 (Q189): a JWT route a learner may still call while a mandatory legal
 * document is `blocked` (consent, logout, data export, account deletion).
 * Every other JWT route is blocked by default; adding one needs TL review
 * and an update of `allow-without-consent.inventory.spec.ts`.
 */
export const AllowWithoutConsent = () =>
  SetMetadata(ALLOW_WITHOUT_CONSENT_KEY, true);
