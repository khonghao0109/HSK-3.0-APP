import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { handleBootstrapFailure } from './bootstrap-failure';

describe('handleBootstrapFailure', () => {
  it('logs only a fixed message and exits without exposing rejected secret material', () => {
    const rawCandidate =
      'base64:U3ludGhldGljQm9vdHN0cmFwU2VjcmV0VGhhdE11c3ROZXZlckJlTG9nZ2Vk';
    const decodedCandidate = 'SyntheticBootstrapSecretThatMustNeverBeLogged';
    const validationError = Object.assign(
      new Error(`runtime validation rejected ${decodedCandidate}`),
      {
        _original: {
          MEDIA_SIGNING_SECRET: rawCandidate,
        },
        details: [
          {
            message: decodedCandidate,
            path: ['MEDIA_SIGNING_SECRET'],
          },
        ],
      },
    );
    const logCalls: unknown[][] = [];
    let exitCode: number | undefined;

    handleBootstrapFailure(validationError, {
      error: (...values: unknown[]) => logCalls.push(values),
      exit: (code: number) => {
        exitCode = code;
      },
    });

    expect(exitCode).toBe(1);
    expect(logCalls).toEqual([['Application failed to start.']]);
    const serializedLog = JSON.stringify(logCalls);
    expect(serializedLog).not.toContain(rawCandidate);
    expect(serializedLog).not.toContain(decodedCandidate);
    expect(serializedLog).not.toContain('_original');
    expect(serializedLog).not.toContain('details');
  });

  it('keeps the real console boundary free of the validation error object', () => {
    const rawCandidate =
      'base64:U3ludGhldGljQm9vdHN0cmFwU2VjcmV0VGhhdE11c3ROZXZlckJlTG9nZ2Vk';
    const decodedCandidate = 'SyntheticBootstrapSecretThatMustNeverBeLogged';
    const validationError = Object.assign(new Error(decodedCandidate), {
      _original: { JWT_SECRET: rawCandidate },
    });
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const processExit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    try {
      handleBootstrapFailure(validationError);

      expect(processExit).toHaveBeenCalledWith(1);
      expect(consoleError).toHaveBeenCalledWith('Application failed to start.');
      const serializedLog = JSON.stringify(consoleError.mock.calls);
      expect(serializedLog).not.toContain(rawCandidate);
      expect(serializedLog).not.toContain(decodedCandidate);
      expect(consoleError).not.toHaveBeenCalledWith(
        expect.anything(),
        validationError,
      );
    } finally {
      consoleError.mockRestore();
      processExit.mockRestore();
    }
  });

  it('sanitizes a real Nest initialization failure before any logger sees the rejected environment', () => {
    const decodedCandidate = 'change-me-bootstrap-secret-with-padding-1234';
    const rawCandidate = `base64:${Buffer.from(decodedCandidate).toString('base64')}`;
    const secret = (purpose: string) =>
      createHash('sha256')
        .update(`hsk-bootstrap-probe-${purpose}`)
        .digest('base64');
    const result = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', 'src/main.ts'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PORT: '39873',
          DATABASE_URL:
            'postgresql://bootstrap_probe:bootstrap_probe@127.0.0.1:1/bootstrap_probe',
          JWT_SECRETS: JSON.stringify({ v1: secret('jwt') }),
          JWT_ACTIVE_KID: 'v1',
          AUTH_PASSWORD_PEPPER: secret('password-pepper'),
          ALLOWED_ORIGINS: 'https://admin.example.test',
          MEDIA_STORAGE_BUCKET: 'hsk-bootstrap-probe',
          MEDIA_STORAGE_REGION: 'ap-southeast-1',
          MEDIA_SIGNING_SECRET: rawCandidate,
          MEDIA_SCANNER_HOST: 'clamav.example.test',
          MEDIA_METRICS_BEARER_TOKEN: secret('metrics'),
          MEDIA_METRICS_HOST: '127.0.0.1',
          MEDIA_METRICS_PORT: '39874',
        },
        timeout: 90_000,
      },
    );

    const output = `${result.stdout}${result.stderr}`;
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(output).toContain('Application failed to start.');
    expect(output).not.toContain(rawCandidate);
    expect(output).not.toContain(decodedCandidate);
    expect(output).not.toContain('_original');
    expect(output).not.toContain('MEDIA_SIGNING_SECRET');
    expect(output).not.toContain('ValidationError');
  }, 100_000);
});
