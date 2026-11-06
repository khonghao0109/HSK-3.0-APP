import { randomBytes } from 'node:crypto';

const CSP_NONCE_BYTES = 18;
const CSP_NONCE_PATTERN = /^[A-Za-z0-9+/]{24}$/u;

export function generateCspNonce(): string {
  return randomBytes(CSP_NONCE_BYTES).toString('base64');
}

export function isValidCspNonce(value: string): boolean {
  return CSP_NONCE_PATTERN.test(value);
}

export function buildContentSecurityPolicy(
  nonce: string,
  development: boolean,
): string {
  if (!isValidCspNonce(nonce)) {
    throw new Error('A valid per-request CSP nonce is required.');
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-inline'" : ''}`,
    "img-src 'self' data:",
    "font-src 'self'",
    // R12 (M4.2b, TL-149): audio tải trước thành Blob rồi phát qua blob: URL.
    // Blob chỉ sinh từ byte fetch same-origin qua BFF; vẫn cấm https:,
    // wildcard và origin storage.
    "media-src 'self' blob:",
    "connect-src 'self'",
  ].join('; ');
}
