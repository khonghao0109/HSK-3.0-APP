const APP_ORIGIN_ERROR = 'APP_ORIGIN must be an absolute HTTP(S) origin.';

export function validateAppOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new Error(APP_ORIGIN_ERROR);
    }
    return url.origin;
  } catch {
    throw new Error(APP_ORIGIN_ERROR);
  }
}

export function buildSessionLoginUrl(appOrigin: string): string {
  return new URL(
    '/login?reason=session',
    validateAppOrigin(appOrigin),
  ).toString();
}
