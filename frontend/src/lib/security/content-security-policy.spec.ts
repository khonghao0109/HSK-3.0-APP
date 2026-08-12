import { describe, expect, it } from 'vitest';

import {
  buildContentSecurityPolicy,
  generateCspNonce,
  isValidCspNonce,
} from './content-security-policy';

describe('production content security policy', () => {
  it('generates a cryptographically random base64 nonce per request', () => {
    const first = generateCspNonce();
    const second = generateCspNonce();

    expect(isValidCspNonce(first)).toBe(true);
    expect(isValidCspNonce(second)).toBe(true);
    expect(first).not.toBe(second);
  });

  it('uses a strict production script and media policy', () => {
    const nonce = generateCspNonce();
    const policy = buildContentSecurityPolicy(nonce, false);

    expect(policy).toContain(
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    );
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("media-src 'self'");
    expect(policy).not.toContain('media-src https:');
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
  });

  it('limits unsafe-eval to development without allowing inline scripts', () => {
    const policy = buildContentSecurityPolicy(generateCspNonce(), true);

    expect(policy).toContain("'unsafe-eval'");
    expect(policy.match(/script-src[^;]*/u)?.[0]).not.toContain(
      "'unsafe-inline'",
    );
  });
});
