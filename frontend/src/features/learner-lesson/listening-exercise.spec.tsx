import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import { LessonPlayer } from './lesson-player';
import type { PlayerExercise } from './lesson-player-model';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

const SIG = 'ab'.repeat(32);
const listening: PlayerExercise = {
  id: 14,
  prompt: 'Nghe và chọn đáp án đúng.',
  answered: false,
  kind: 'listening',
  options: [
    { id: 'shop', text: '商店' },
    { id: 'market', text: '超市' },
    { id: 'bank', text: '银行' },
    { id: 'rest', text: '餐馆' },
  ],
  media: { id: 7, duration: 3 },
};

let fetchSpy: MockInstance<typeof fetch>;
let grantSeq = 0;
let grantTtlMs = 300_000;
const times = new WeakMap<HTMLMediaElement, number>();
const durations = new WeakMap<HTMLMediaElement, number>();
let playSpy: MockInstance<HTMLMediaElement['play']>;
let pauseSpy: MockInstance<HTMLMediaElement['pause']>;

function grantResponse() {
  grantSeq += 1;
  return Response.json({
    success: true,
    data: {
      src: `/api/learner/media/7/content?expires=${1791000000 + grantSeq}&signature=${SIG}`,
      expiresAt: new Date(Date.now() + grantTtlMs).toISOString(),
    },
  });
}

function urls(): string[] {
  return fetchSpy.mock.calls.map(([url]) => String(url));
}

function audio(container: HTMLElement): HTMLAudioElement {
  const element = container.querySelector<HTMLAudioElement>('.ex audio');
  if (!element) throw new Error('no audio element');
  return element;
}

function playButton() {
  return document.querySelector<HTMLButtonElement>('.ls-play');
}

function timesText(container: HTMLElement) {
  return [...container.querySelectorAll('.ls-audio__time > span')].map(
    (span) => span.textContent,
  );
}

function rest(container: HTMLElement) {
  return container.querySelectorAll('.ls-wave rect.is-rest').length;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderListening() {
  return render(
    <div className="app">
      <LessonPlayer
        lessonId={5}
        exercises={[listening]}
        startIndex={0}
        needsStart={false}
      />
    </div>,
  );
}

describe('ListeningExercise (M2.5c)', () => {
  beforeEach(() => {
    grantSeq = 0;
    grantTtlMs = 300_000;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/access')) return Promise.resolve(grantResponse());
      if (url.includes('/attempts')) {
        return Promise.resolve(
          Response.json({
            success: true,
            data: { isCorrect: true, explanation: null },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(function (this: HTMLMediaElement) {
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
      });
    pauseSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(function (this: HTMLMediaElement) {
        this.dispatchEvent(new Event('pause'));
      });
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(
      HTMLMediaElement.prototype,
      'currentTime',
      'get',
    ).mockImplementation(function (this: HTMLMediaElement) {
      return times.get(this) ?? 0;
    });
    vi.spyOn(
      HTMLMediaElement.prototype,
      'currentTime',
      'set',
    ).mockImplementation(function (this: HTMLMediaElement, value: number) {
      times.set(this, value);
    });
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockImplementation(
      function (this: HTMLMediaElement) {
        return durations.get(this) ?? Number.NaN;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows mẫu 05 idle: no autoplay, no bytes, only the grant (Q55, Q56)', async () => {
    const { container } = renderListening();
    await settle();
    const element = audio(container);
    expect(element.getAttribute('preload')).toBe('none');
    expect(element.hasAttribute('src')).toBe(false);
    expect(element.hasAttribute('controls')).toBe(false);
    expect(playSpy).not.toHaveBeenCalled();
    expect(urls()).toEqual(['/api/learner/media/7/access']);

    const play = playButton();
    expect(play?.getAttribute('aria-label')).toBe('Phát');
    expect(play?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelectorAll('.ls-wave rect')).toHaveLength(67);
    expect(rest(container)).toBe(67);
    expect(container.querySelector('.ls-wave [style]')).toBeNull();
    expect(timesText(container)).toEqual(['0:00', '0:03']);
    expect(
      [...container.querySelectorAll('.ls-tools button')].map(
        (b) => b.textContent,
      ),
    ).toEqual(['Nghe lại']);
    expect(container.textContent).not.toMatch(/transcript/iu);
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('plays from the grant inside the click and tracks progress', async () => {
    const { container } = renderListening();
    await settle();
    const element = audio(container);

    fireEvent.click(playButton() as HTMLButtonElement);
    // Same task as the click: no await between the press and play().
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(element.getAttribute('src')).toBe(
      `/api/learner/media/7/content?expires=1791000001&signature=${SIG}`,
    );
    expect(playButton()?.getAttribute('aria-label')).toBe('Tạm dừng');
    expect(playButton()?.getAttribute('aria-pressed')).toBe('true');

    durations.set(element, 3);
    fireEvent(element, new Event('loadedmetadata'));
    element.currentTime = 1.6;
    fireEvent(element, new Event('timeupdate'));
    expect(timesText(container)).toEqual(['0:01', '0:03']);
    const midRest = rest(container);
    expect(midRest).toBeGreaterThan(0);
    expect(midRest).toBeLessThan(67);

    fireEvent.click(playButton() as HTMLButtonElement);
    expect(pauseSpy).toHaveBeenCalled();
    expect(playButton()?.getAttribute('aria-label')).toBe('Phát');

    element.currentTime = 2.97;
    fireEvent(element, new Event('timeupdate'));
    fireEvent(element, new Event('pause'));
    fireEvent(element, new Event('ended'));
    expect(playButton()?.getAttribute('aria-label')).toBe('Phát');
    expect(rest(container)).toBe(0);
    expect(timesText(container)).toEqual(['0:03', '0:03']);
    expect(urls().filter((url) => url.includes('/content'))).toEqual([]);
  });

  it('Nghe lại plays again from the start', async () => {
    const { container } = renderListening();
    await settle();
    const element = audio(container);
    fireEvent.click(playButton() as HTMLButtonElement);
    element.currentTime = 2.5;
    fireEvent(element, new Event('ended'));

    fireEvent.click(screen.getByRole('button', { name: 'Nghe lại' }));
    expect(element.currentTime).toBe(0);
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it('renews a grant that is about to expire before playing', async () => {
    grantTtlMs = 5_000;
    const { container } = renderListening();
    await settle();
    fireEvent.click(playButton() as HTMLButtonElement);
    expect(playSpy).not.toHaveBeenCalled();
    await settle();
    expect(urls()).toEqual([
      '/api/learner/media/7/access',
      '/api/learner/media/7/access',
    ]);
    expect(audio(container).getAttribute('src')).toContain(
      'expires=1791000002',
    );
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('retries once with a new grant, then shows the error and Phát', async () => {
    const { container } = renderListening();
    await settle();
    const element = audio(container);
    fireEvent.click(playButton() as HTMLButtonElement);

    fireEvent(element, new Event('error'));
    await settle();
    expect(urls()).toHaveLength(2);
    expect(element.getAttribute('src')).toContain('expires=1791000002');
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.ex-error')).toBeNull();

    fireEvent(element, new Event('error'));
    await settle();
    expect(urls()).toHaveLength(2);
    expect(container.querySelector('.ex-error')?.textContent).toBe(
      'Không tải được audio.',
    );
    expect(playButton()?.getAttribute('aria-label')).toBe('Phát');
    expect(playButton()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('answers without listening first (Q57) and stops on unmount', async () => {
    const { container, unmount } = renderListening();
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    const check = screen.getByRole('button', { name: 'Kiểm tra' });
    expect(check.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(check);
    await settle();
    const attempt = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/attempts'),
    );
    expect(JSON.parse(String(attempt?.[1]?.body))).toMatchObject({
      answer: { optionId: 'market' },
    });
    expect(playSpy).not.toHaveBeenCalled();

    fireEvent.click(playButton() as HTMLButtonElement);
    const element = audio(container);
    pauseSpy.mockClear();
    unmount();
    expect(pauseSpy).toHaveBeenCalled();
    expect(element.hasAttribute('src')).toBe(false);
  });
  it('does not play a grant that arrives after unmount', async () => {
    let release: (response: Response) => void = () => {};
    fetchSpy.mockImplementation(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    const { unmount } = renderListening();
    fireEvent.click(playButton() as HTMLButtonElement);
    unmount();
    release(grantResponse());
    await settle();
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('after a failure, Phát takes a fresh grant again', async () => {
    const { container } = renderListening();
    await settle();
    const element = audio(container);
    fireEvent.click(playButton() as HTMLButtonElement);
    fireEvent(element, new Event('error'));
    await settle();
    fireEvent(element, new Event('error'));
    await settle();
    expect(container.querySelector('.ex-error')).not.toBeNull();
    // jsdom has no MediaError; the element keeps one after a failure.
    Object.defineProperty(element, 'error', { value: { code: 4 } });

    // Marker: only a new src assignment (not a bare play()) restores it.
    element.removeAttribute('src');

    fireEvent.click(playButton() as HTMLButtonElement);
    expect(container.querySelector('.ex-error')).toBeNull();
    // The grant fetched by the retry is still fresh: src again, in the click.
    expect(element.getAttribute('src')).toContain('expires=1791000002');
    expect(playSpy).toHaveBeenCalledTimes(3);
  });
});
