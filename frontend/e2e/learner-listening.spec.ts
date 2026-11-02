import {
  expect,
  request as playwrightRequest,
  test,
  type Page,
} from '@playwright/test';

import {
  BACKEND,
  backendLogin,
  call,
  LISTENING_PROMPT,
  PASSWORD,
  publishPracticeExercises,
  readCspViolations,
  registerReadyLearner,
  watchCsp,
} from './support/learner-fixtures';

// HSK 3 lesson of publishPracticeExercises: arrange_sentence, fill_blank,
// then listening_choice with a 3-second WAV ingested into the backend's
// memory storage. The first two are answered by API, so the player opens on
// the listening question (3/3).
const CONTENT = /^\/api\/learner\/media\/\d+\/content$/u;

type Exercise = { id: number; type: string };
type Activity = { standaloneExercises: Exercise[] };

async function backend(
  token: string,
  route: string,
  data: unknown,
  key: string,
): Promise<void> {
  const api = await playwrightRequest.newContext();
  try {
    const response = await api.post(`${BACKEND}${route}`, {
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
      data,
    });
    expect(response.status(), `POST ${route}`).toBe(201);
  } finally {
    await api.dispose();
  }
}

/** Starts the lesson and answers arrange and fill_blank for the learner. */
async function answerFirstTwo(email: string, lessonId: number) {
  const api = await playwrightRequest.newContext();
  let token = '';
  let activity: Activity;
  try {
    token = await backendLogin(api, email, PASSWORD);
    activity = await call<Activity>(
      api,
      'GET',
      `/learning/lessons/${lessonId}/activity`,
      token,
    );
  } finally {
    await api.dispose();
  }
  // Same key as the BFF start, so the player only replays it.
  await backend(
    token,
    `/learning/lessons/${lessonId}/start`,
    {},
    `lesson-start-${lessonId}`,
  );
  const answers: Record<string, unknown> = {
    arrange_sentence: { tokenIds: ['wo', 'xiang', 'mai'] },
    fill_blank: { text: '买' },
  };
  for (const exercise of activity.standaloneExercises) {
    const answer = answers[exercise.type];
    if (!answer) continue;
    await backend(
      token,
      `/learning/exercises/${exercise.id}/attempts`,
      { answer },
      `attempt-e2e-${exercise.id}-${Date.now()}`,
    );
  }
  const listening = activity.standaloneExercises.find(
    (exercise) => exercise.type === 'listening_choice',
  );
  if (!listening) throw new Error('fixture has no listening_choice');
  return { token, listeningId: listening.id };
}

type AudioState = { paused: boolean; ended: boolean; t: number; src: string };

function audioState(page: Page): Promise<AudioState | null> {
  return page.evaluate(() => {
    const audio = document.querySelector<HTMLAudioElement>('.ex audio');
    return audio
      ? {
          paused: audio.paused,
          ended: audio.ended,
          t: audio.currentTime,
          src: audio.currentSrc || audio.src,
        }
      : null;
  });
}

async function openListening(page: Page, baseURL: string | undefined) {
  const email = await registerReadyLearner(page, baseURL);
  const lessonId = await publishPracticeExercises();
  const learner = await answerFirstTwo(email, lessonId);
  const content: string[] = [];
  page.on('request', (request) => {
    if (CONTENT.test(new URL(request.url()).pathname)) {
      content.push(request.url());
    }
  });
  await page.goto(`/learn/lessons/${lessonId}/practice`);
  await expect(page.locator('.m02-bar__count')).toHaveText('3/3');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(
    LISTENING_PROMPT,
  );
  return { ...learner, content };
}

test.describe('Listening question (M2.5c)', () => {
  test('does not autoplay or load audio, then plays through the BFF (Q55, Q56)', async ({
    page,
    baseURL,
  }) => {
    const cspConsole = await watchCsp(page);
    const { content } = await openListening(page, baseURL);
    const play = page.locator('.ls-play');
    await expect(play).toHaveAttribute('aria-label', 'Phát');
    await expect(play).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.ls-wave rect')).toHaveCount(67);
    await expect(page.locator('.ls-wave rect.is-rest')).toHaveCount(67);
    await expect(page.locator('.ls-audio__time > span')).toHaveText([
      '0:00',
      '0:03',
    ]);
    await page.waitForTimeout(1500);
    expect((await audioState(page))?.paused).toBe(true);
    expect(content).toEqual([]);

    await play.click();
    await expect
      .poll(async () => (await audioState(page))?.t ?? 0, { timeout: 8000 })
      .toBeGreaterThan(0.3);
    await expect(play).toHaveAttribute('aria-label', 'Tạm dừng');
    await expect(play).toHaveAttribute('aria-pressed', 'true');
    const state = await audioState(page);
    const src = new URL(state?.src ?? '', baseURL);
    expect(src.origin).toBe(new URL(baseURL ?? '').origin);
    expect(src.pathname).toMatch(CONTENT);
    expect(content.length).toBeGreaterThan(0);

    await expect
      .poll(async () => (await audioState(page))?.ended, { timeout: 8000 })
      .toBe(true);
    await expect(play).toHaveAttribute('aria-label', 'Phát');
    await expect(page.locator('.ls-wave rect.is-rest')).toHaveCount(0);
    await expect(page.locator('.ls-audio__time > span')).toHaveText([
      '0:03',
      '0:03',
    ]);

    await page.getByRole('button', { name: 'Nghe lại' }).click();
    await expect
      .poll(async () => (await audioState(page))?.paused, { timeout: 5000 })
      .toBe(false);
    expect((await audioState(page))?.t ?? 9).toBeLessThan(2);

    await page.getByRole('radio', { name: '超市' }).click();
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(page.locator('.m02-feedback__title')).toHaveText('Chính xác!');
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page.locator('.ex audio')).toHaveCount(0);
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
  });

  test('the BFF content route serves Range and needs a session', async ({
    page,
    baseURL,
  }) => {
    await openListening(page, baseURL);
    await page.locator('.ls-play').click();
    await expect
      .poll(async () => (await audioState(page))?.src ?? '')
      .toMatch(/\/content\?/u);
    const src = (await audioState(page))?.src ?? '';

    // Through the page's own fetch: the session cookie is Secure, and
    // Playwright's request API sends Secure cookies to localhost only.
    const part = await page.evaluate(async (url) => {
      const response = await fetch(url, { headers: { range: 'bytes=0-1' } });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: String.fromCharCode(...bytes),
      };
    }, src);
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toMatch(/^bytes 0-1\/\d+$/u);
    expect(part.headers['accept-ranges']).toBe('bytes');
    expect(part.headers['cache-control']).toBe('private, no-store');
    expect(part.headers['content-type']).toMatch(/^audio\/wav/u);
    expect(part.body).toBe('RI');

    const extra = await page.evaluate(
      async (url) => (await fetch(`${url}&x=1`)).status,
      src,
    );
    expect(extra).toBe(400);

    const anon = await playwrightRequest.newContext({ baseURL });
    try {
      expect((await anon.get(src)).status()).toBe(401);
      const access = await anon.get(
        new URL(src).pathname.replace(/content$/u, 'access'),
      );
      expect(access.status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  test('a refused grant is renewed once and plays; a wrong answer is stored', async ({
    page,
    baseURL,
  }) => {
    let refused = 0;
    await page.route(
      (url) => CONTENT.test(url.pathname),
      (route) => {
        if (refused++ === 0) {
          return route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: '{"success":false}',
          });
        }
        return route.continue();
      },
    );
    const access: string[] = [];
    page.on('request', (request) => {
      if (/\/api\/learner\/media\/\d+\/access$/u.test(request.url())) {
        access.push(request.url());
      }
    });
    const { token, listeningId } = await openListening(page, baseURL);
    await page.locator('.ls-play').click();
    await expect
      .poll(async () => (await audioState(page))?.t ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(0.3);
    // One refused, then the retried request; the mount grant plus one renewal.
    expect(refused).toBe(2);
    expect(access).toHaveLength(2);
    await expect(page.locator('.ex-error')).toHaveCount(0);

    await page.getByRole('radio', { name: '商店' }).click();
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(page.locator('.m02-feedback--wrong')).toBeVisible();
    const api = await playwrightRequest.newContext();
    try {
      const attempts = await call<Array<{ isCorrect: boolean }>>(
        api,
        'GET',
        `/learning/exercises/${listeningId}/attempts`,
        token,
      );
      expect(attempts.map((attempt) => attempt.isCorrect)).toEqual([false]);
    } finally {
      await api.dispose();
    }
  });

  // M2.5e (Q170, Q171): the speed picker reaches the media element, and
  // picking it while idle still downloads no audio bytes (Q56).
  test('E1: plays at 0,75× after choosing it (Q170, Q171)', async ({
    page,
    baseURL,
  }) => {
    await openListening(page, baseURL);
    const group = page.getByRole('group', { name: 'Tốc độ phát' });
    const slow = group.getByRole('button', { name: '0,75×' });
    const normal = group.getByRole('button', { name: '1×' });
    await expect(normal).toHaveAttribute('aria-pressed', 'true');
    await expect(slow).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.ls-speed-note')).toHaveText('Tốc độ 1×');

    await slow.click();
    await expect(slow).toHaveAttribute('aria-pressed', 'true');
    await expect(normal).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.ls-speed-note')).toHaveText('Tốc độ 0,75×');

    await page.locator('.ls-play').click();
    const rate = () =>
      page
        .locator('audio')
        .evaluate((element) => (element as HTMLAudioElement).playbackRate);
    const defaultRate = () =>
      page
        .locator('audio')
        .evaluate(
          (element) => (element as HTMLAudioElement).defaultPlaybackRate,
        );
    await expect.poll(rate, { timeout: 8000 }).toBe(0.75);
    await expect.poll(defaultRate, { timeout: 8000 }).toBe(0.75);
  });

  test('E2: changing speed before Phát loads no audio bytes (Q56, Q171)', async ({
    page,
    baseURL,
  }) => {
    const media: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/learner/media/')) {
        media.push(request.url());
      }
    });
    // Hydration marker: the mount grant has been answered, so the speed
    // button's handler is live before the click below.
    const mountGrant = page.waitForResponse(
      (response) =>
        response.url().endsWith('/access') && response.status() === 200,
    );
    await openListening(page, baseURL);
    await mountGrant;
    await expect(page.locator('.ls-audio__time > span')).toHaveText([
      '0:00',
      '0:03',
    ]);
    // Q56: the only up-front call is the access grant, never the bytes.
    expect(
      media.filter((url) => new URL(url).pathname.endsWith('/access')),
    ).toHaveLength(1);
    const before = media.length;

    const slow = page
      .getByRole('group', { name: 'Tốc độ phát' })
      .getByRole('button', { name: '0,75×' });
    await slow.click();
    await expect(slow).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(750);
    expect(media.length).toBe(before);
    expect(
      media.filter((url) => /\/content$/u.test(new URL(url).pathname)),
    ).toEqual([]);
    expect((await audioState(page))?.src ?? '').toBe('');
    expect((await audioState(page))?.paused).toBe(true);
  });

  // M2.5e (Q170, TL-204): the arrow/space focus ring must be visible on the
  // speed buttons, including the selected one.
  test('E3: speed buttons show a focus ring from the keyboard (Q170)', async ({
    page,
    baseURL,
  }) => {
    await openListening(page, baseURL);
    const slow = page
      .getByRole('group', { name: 'Tốc độ phát' })
      .getByRole('button', { name: '0,75×' });

    let reached = false;
    for (let attempt = 0; attempt < 40 && !reached; attempt += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return (
          active !== null &&
          active.textContent?.trim() === '0,75×' &&
          active.closest('.ls-tools') !== null
        );
      });
    }
    expect(reached, 'keyboard reached the 0,75× button').toBe(true);

    // Read the token in the learner scope (the exam/admin root has another
    // --jade-700), then convert it to the rgb() form box-shadow computes.
    const ring = () =>
      slow.evaluate((element) => {
        const root =
          element.closest('.learner-app') ?? document.documentElement;
        const token = getComputedStyle(root)
          .getPropertyValue('--jade-700')
          .trim();
        const probe = document.createElement('span');
        probe.style.color = token;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return { shadow: getComputedStyle(element).boxShadow, token, color };
      });

    const unselected = await ring();
    expect(unselected.token).not.toBe('');
    expect(unselected.shadow).toContain(unselected.color);

    await page.keyboard.press('Space');
    await expect(slow).toHaveAttribute('aria-pressed', 'true');
    const selected = await ring();
    expect(selected.shadow).toContain(selected.color);
    await expect(page.locator('.ls-speed-note')).toHaveText('Tốc độ 0,75×');
  });
});
