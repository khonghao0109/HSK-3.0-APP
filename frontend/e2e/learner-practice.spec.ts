import {
  expect,
  request as playwrightRequest,
  test,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  backendLogin,
  call,
  FILL_EXPLANATION,
  FILL_PROMPT,
  LISTENING_PROMPT,
  PASSWORD,
  publishLockedLesson,
  publishPracticeExercises,
  readCspViolations,
  readyLessonId,
  registerReadyLearner,
  watchCsp,
} from './support/learner-fixtures';

// HSK 1 lesson (seed): mcq "Choose the meaning of 你好" (Hello is right)
// first; its seeded listening_choice disappears once admin-console has
// quarantined the audio, so the total is read from the backend. HSK 3 lesson
// (publishPracticeExercises): arrange_sentence, fill_blank, listening_choice
// (with a real ingested WAV since M2.5c).
const MCQ_EXPLANATION = '你好 is the standard greeting “hello”.';
const DONE = 'Bạn đã làm xong phần luyện tập';

type Activity = {
  progress: { status: string };
  topics: Array<{ exercises: Array<{ id: number; type: string }> }>;
  standaloneExercises: Array<{ id: number; type: string }>;
};

/** Backend view of the learner: activity and the attempts of an exercise. */
async function backendView(email: string, lessonId: number) {
  const api = await playwrightRequest.newContext();
  try {
    const token = await backendLogin(api, email, PASSWORD);
    const activity = await call<Activity>(
      api,
      'GET',
      `/learning/lessons/${lessonId}/activity`,
      token,
    );
    const exercises = [
      ...activity.topics.flatMap((topic) => topic.exercises),
      ...activity.standaloneExercises,
    ];
    const attempts: Record<string, Array<{ isCorrect: boolean }>> = {};
    for (const exercise of exercises) {
      attempts[exercise.type] = await call(
        api,
        'GET',
        `/learning/exercises/${exercise.id}/attempts`,
        token,
      );
    }
    return { status: activity.progress.status, attempts };
  } finally {
    await api.dispose();
  }
}

function tabBar(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Điều hướng chính' });
}

function count(page: Page): Locator {
  return page.locator('.m02-bar__count');
}

function check(page: Page): Locator {
  return page.getByRole('button', { name: 'Kiểm tra' });
}

function feedback(page: Page): Locator {
  return page.locator('.ex > [aria-live="polite"]');
}

async function exerciseCount(lessonId: number): Promise<number> {
  const api = await playwrightRequest.newContext();
  try {
    const detail = await call<{ exercises: unknown[] }>(
      api,
      'GET',
      `/learning/lessons/${lessonId}`,
    );
    return detail.exercises.length;
  } finally {
    await api.dispose();
  }
}

async function openPractice(page: Page, lessonId: number): Promise<void> {
  await page.goto(`/learn/lessons/${lessonId}`);
  await page.getByRole('link', { name: 'Tiếp tục học' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/learn/lessons/${lessonId}/practice$`),
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Luyện tập');
}

test.describe('Learner activity player (M2.5b)', () => {
  let hsk1Lesson = 0;
  let hsk3Lesson = 0;
  let lockedLesson = 0;

  test.beforeAll(async () => {
    const hsk1 = await readyLessonId('HSK1');
    if (!hsk1) throw new Error('seed has no ready HSK1 lesson');
    hsk1Lesson = hsk1;
    hsk3Lesson = await publishPracticeExercises();
    lockedLesson = await publishLockedLesson();
  });

  test('mcq right from Tiếp tục học, with the tab bar hidden (Q45)', async ({
    page,
    baseURL,
  }) => {
    const email = await registerReadyLearner(page, baseURL);
    const total = await exerciseCount(hsk1Lesson);
    await openPractice(page, hsk1Lesson);
    await expect(tabBar(page)).toBeHidden();
    await expect(count(page)).toHaveText(`1/${total}`);
    await expect(count(page)).toHaveAttribute(
      'aria-label',
      `Câu 1 trên ${total}`,
    );

    const group = page.getByRole('radiogroup', {
      name: 'Choose the meaning of 你好',
    });
    await expect(group.getByRole('radio')).toHaveCount(2);
    await group.getByRole('radio', { name: 'Hello' }).click();
    await check(page).click();
    await expect(feedback(page)).toContainText('Chính xác!');
    await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeFocused();
    await expect(group.getByRole('radio', { name: 'Hello' })).toHaveClass(
      /is-right/u,
    );

    const view = await backendView(email, hsk1Lesson);
    expect(view.status).toBe('learning');
    expect(view.attempts.mcq?.map((a) => a.isCorrect)).toEqual([true]);
  });

  test('mcq wrong shows the explanation and only Tiếp tục (Q50)', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await openPractice(page, hsk1Lesson);
    await page.getByRole('radio', { name: 'Thank you' }).click();
    await check(page).click();
    const wrong = page.locator('.m02-feedback--wrong');
    await expect(wrong).toBeVisible();
    await expect(wrong.locator('.m02-feedback__title')).toHaveText('Chưa đúng');
    await expect(wrong.locator('.m02-feedback__text')).toHaveText(
      MCQ_EXPLANATION,
    );
    await expect(wrong).not.toContainText('Đáp án');
    await expect(wrong.getByRole('button')).toHaveText(['Tiếp tục']);
    await expect(wrong.getByRole('button')).toBeFocused();
    await expect(page.getByRole('radio', { name: 'Thank you' })).toHaveClass(
      /is-wrong/u,
    );
  });

  test('arrange right from the Luyện tập row, then fill_blank (Q47)', async ({
    page,
    baseURL,
  }) => {
    const email = await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${hsk3Lesson}`);
    await page.locator('.lesson-rows a.lrow').click();
    await expect(page).toHaveURL(
      new RegExp(`/learn/lessons/${hsk3Lesson}/practice$`),
    );
    await expect(count(page)).toHaveText('1/3');

    await expect(
      page.getByText('Chạm vào các từ ở trên để ghép câu'),
    ).toBeVisible();
    // Keyboard only: Enter on each word in order.
    for (const word of ['我', '想', '买']) {
      const button = page.getByRole('button', { name: `Thêm ${word}` });
      await button.focus();
      await page.keyboard.press('Enter');
    }
    await expect(check(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toContainText('Chính xác!');
    await expect(page.locator('.pr-answer__row .pr-chip')).toHaveText([
      '我',
      '想',
      '买',
    ]);
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    await expect(count(page)).toHaveText('2/3');
    const heading = page.getByRole('heading', { level: 2 });
    await expect(heading).toBeFocused();
    await expect(heading).toHaveText(/我想.*东西。/u);
    await expect(page.locator('.fb-blank')).toHaveCount(1);
    const input = page.getByLabel('Câu trả lời của bạn');
    await input.fill('  买 ');
    await expect(page.locator('.fb-blank')).toHaveText('买');
    await input.press('Enter');
    await expect(feedback(page)).toContainText('Chính xác!');

    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    // M2.5c: listening_choice with audio is a real question; it can be
    // checked without listening first (Q57). Playback: learner-listening.
    await expect(count(page)).toHaveText('3/3');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(
      LISTENING_PROMPT,
    );
    await page.getByRole('radio', { name: '超市' }).click();
    await check(page).click();
    await expect(feedback(page)).toContainText('Chính xác!');
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(DONE);
    await expect(
      page.getByRole('link', { name: 'Về bài học' }),
    ).toHaveAttribute('href', `/learn/lessons/${hsk3Lesson}`);

    const view = await backendView(email, hsk3Lesson);
    expect(view.status).toBe('learning');
    expect(view.attempts.arrange_sentence?.map((a) => a.isCorrect)).toEqual([
      true,
    ]);
    expect(view.attempts.fill_blank?.map((a) => a.isCorrect)).toEqual([true]);
    expect(view.attempts.listening_choice?.map((a) => a.isCorrect)).toEqual([
      true,
    ]);
  });

  test('fill_blank wrong shows its explanation', async ({ page, baseURL }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${hsk3Lesson}/practice`);
    for (const word of ['买', '我', '想']) {
      await page.getByRole('button', { name: `Thêm ${word}` }).click();
    }
    await check(page).click();
    await expect(page.locator('.m02-feedback--wrong')).toBeVisible();
    await expect(page.locator('.pr-answer__row .is-wrong')).toHaveCount(3);
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page.getByRole('heading', { level: 2 })).toContainText(
      FILL_PROMPT.slice(0, 2),
    );
    await page.getByLabel('Câu trả lời của bạn').fill('卖');
    await check(page).click();
    await expect(
      page.locator('.m02-feedback--wrong .m02-feedback__text'),
    ).toHaveText(FILL_EXPLANATION);
  });

  test('X goes straight back; reopening resumes at the first unanswered (Q49)', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await openPractice(page, hsk3Lesson);
    for (const word of ['我', '想', '买']) {
      await page.getByRole('button', { name: `Thêm ${word}` }).click();
    }
    await check(page).click();
    await expect(feedback(page)).toContainText('Chính xác!');

    await page.getByRole('link', { name: 'Thoát bài luyện tập' }).click();
    await expect(page).toHaveURL(new RegExp(`/learn/lessons/${hsk3Lesson}$`));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(tabBar(page)).toBeVisible();

    await page.getByRole('link', { name: 'Tiếp tục học' }).click();
    await expect(count(page)).toHaveText('2/3');
    await expect(page.getByLabel('Câu trả lời của bạn')).toBeVisible();
  });

  test('a double submit stores one attempt', async ({ page, baseURL }) => {
    const email = await registerReadyLearner(page, baseURL);
    await openPractice(page, hsk1Lesson);
    await page.getByRole('radio', { name: 'Thank you' }).click();
    await check(page).dblclick();
    await expect(page.locator('.m02-feedback--wrong')).toBeVisible();
    const view = await backendView(email, hsk1Lesson);
    expect(view.attempts.mcq).toHaveLength(1);
  });

  test('a locked lesson never opens the player (Q44)', async ({
    page,
    baseURL,
  }) => {
    const email = await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${lockedLesson}/practice`);
    await expect(page).toHaveURL(new RegExp(`/learn/lessons/${lockedLesson}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Bài khoá e2e',
    );
    await expect(page.locator('a[href$="/practice"]')).toHaveCount(0);
    const view = await backendView(email, lockedLesson);
    expect(view.status).toBe('not_started');
  });

  for (const id of ['999999', 'abc']) {
    test(`/learn/lessons/${id}/practice is the Vietnamese 404 with the tab bar (Q41)`, async ({
      page,
      baseURL,
    }) => {
      await registerReadyLearner(page, baseURL);
      const response = await page.goto(`/learn/lessons/${id}/practice`);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Không tìm thấy bài học',
      );
      await expect(tabBar(page)).toBeVisible();
    });
  }

  test('the BFF rejects a cross-origin attempt and a bad key', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    const origin = new URL(baseURL ?? 'http://127.0.0.1:3200').origin;
    const path = '/api/learner/exercises/1/attempts';
    const crossOrigin = await page.request.post(path, {
      headers: {
        origin: 'http://evil.example',
        'idempotency-key': 'attempt-12345678',
      },
      data: { answer: { optionId: 'hello' } },
    });
    expect(crossOrigin.status()).toBe(403);
    const badKey = await page.request.post(path, {
      headers: { origin, 'idempotency-key': 'bad key' },
      data: { answer: { optionId: 'hello' } },
    });
    expect(badKey.status()).toBe(400);
  });

  test('the player raises no CSP violation', async ({ page, baseURL }) => {
    await registerReadyLearner(page, baseURL);
    const cspConsole = await watchCsp(page);
    await page.goto(`/learn/lessons/${hsk3Lesson}/practice`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Luyện tập',
    );
    for (const word of ['我', '想', '买']) {
      await page.getByRole('button', { name: `Thêm ${word}` }).click();
    }
    await check(page).click();
    await expect(feedback(page)).toContainText('Chính xác!');
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
  });
});
