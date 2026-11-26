import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConsentForm,
  ConsentPendingBanner,
} from '@/features/legal/consent-form';
import {
  CONSENT_LATER_KEY,
  type ConsentDocumentView,
} from '@/features/legal/consent-values';

const { redirect, session, userConsents, pathname } = vi.hoisted(() => ({
  pathname: vi.fn(() => '/learn/review'),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  session: vi.fn(),
  userConsents: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect,
  usePathname: pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: session,
}));
vi.mock('@/features/legal/legal-documents-service', () => ({
  getUserConsents: userConsents,
}));

import ConsentPage from './page';

// Its own behaviour is proven in privacy-rights-panel.spec.tsx; here only
// where it appears.
vi.mock('@/features/privacy/privacy-rights-panel', () => ({
  PrivacyRightsPanel: () => <section aria-label="Quyền của bạn" />,
}));

const SHA = 'a'.repeat(64);

function doc(
  type: 'terms' | 'privacy',
  status: string,
  extra: Record<string, unknown> = {},
) {
  return {
    type,
    status,
    version: type === 'terms' ? '2026-11-t' : '2026-11-p',
    sha256: SHA,
    effectiveAt: '2026-11-20T00:00:00.000Z',
    deadline: status === 'pending' ? '2026-12-01T00:00:00.000Z' : null,
    ...extra,
  };
}

async function renderPage(returnTo?: string) {
  return render(
    await ConsentPage({
      searchParams: Promise.resolve(returnTo === undefined ? {} : { returnTo }),
    }),
  );
}

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  redirect.mockClear();
  session.mockReset();
  userConsents.mockReset();
  session.mockResolvedValue({ state: 'learner', token: 'tok' });
  pathname.mockReturnValue('/learn/review');
  assign = vi.fn();
  vi.stubGlobal('location', { assign, pathname: '/consent', search: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('/consent page (M1.7b2 B2a)', () => {
  it('sends a signed-out visitor to sign-in', async () => {
    session.mockResolvedValue({ state: 'unauthenticated', token: null });
    await expect(renderPage('/learn')).rejects.toThrow('redirect:/sign-in');
    expect(userConsents).not.toHaveBeenCalled();
  });

  it.each([
    ['/learn/lessons/12?step=2', '/learn/lessons/12?step=2'],
    ['https://evil.example/x', '/learn'],
    ['//evil.example', '/learn'],
    [undefined, '/learn'],
  ])(
    'returns to %s → %s when nothing is left to accept',
    async (returnTo, target) => {
      userConsents.mockResolvedValue([
        doc('terms', 'accepted'),
        doc('privacy', 'not_required'),
      ]);
      await expect(renderPage(returnTo)).rejects.toThrow(`redirect:${target}`);
    },
  );

  it.each([
    ['version', { version: null }],
    ['sha256', { sha256: null }],
    ['effectiveAt', { effectiveAt: null }],
  ])(
    'blocked without a usable %s: shows an error instead of looping back (M1.7b2 B2a2)',
    async (_field, missing) => {
      userConsents.mockResolvedValue([
        doc('terms', 'blocked', missing),
        doc('privacy', 'accepted'),
      ]);
      await renderPage('/learn');
      expect(redirect).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Chưa tải được văn bản cần đồng ý. Thử lại sau ít phút.',
      );
      expect(
        screen.queryByRole('button', { name: 'Đồng ý và tiếp tục' }),
      ).toBeNull();
      expect(
        screen.getByRole('region', { name: 'Quyền của bạn' }),
      ).toBeInTheDocument();
    },
  );

  it('blocked: lists each document with version, effective date and its page, and every action', async () => {
    userConsents.mockResolvedValue([
      doc('terms', 'blocked'),
      doc('privacy', 'pending'),
    ]);
    const { container } = await renderPage('/learn/lessons/12');

    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Chúng tôi đã cập nhật điều khoản',
    );
    expect(container).not.toHaveTextContent('3 điểm thay đổi chính');
    const items = container.querySelectorAll('.consent__doc');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Điều khoản sử dụng');
    expect(items[0]).toHaveTextContent('Phiên bản 2026-11-t');
    expect(items[0]).toHaveTextContent('Hiệu lực 20/11/2026');
    expect(items[1]).toHaveTextContent('Chính sách bảo mật');
    expect(items[1]).toHaveTextContent('Hạn đồng ý 01/12/2026');
    expect(
      screen.getByRole('link', { name: 'Đọc Điều khoản sử dụng' }),
    ).toHaveAttribute('href', '/terms');
    expect(
      screen.getByRole('link', { name: 'Đọc Chính sách bảo mật' }),
    ).toHaveAttribute('href', '/privacy');

    expect(
      screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('region', { name: 'Quyền của bạn' }),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent('Sắp có');
    expect(screen.queryByRole('button', { name: 'Để sau' })).toBeNull();
  });

  it('pending: offers "Để sau" and no blocking-only actions', async () => {
    userConsents.mockResolvedValue([
      doc('terms', 'pending'),
      doc('privacy', 'accepted'),
    ]);
    const { container } = await renderPage();
    expect(container.querySelectorAll('.consent__doc')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Để sau' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Quyền của bạn' })).toBeNull();
  });
});

const DOCS: ConsentDocumentView[] = [
  {
    type: 'terms',
    status: 'blocked',
    version: '2026-11-t',
    sha256: SHA,
    effectiveAt: '2026-11-20T00:00:00.000Z',
    deadline: null,
  },
];

describe('ConsentForm (M1.7b2 B2a)', () => {
  it('does nothing until the checkbox is ticked', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<ConsentForm mode="blocked" documents={DOCS} returnTo="/learn" />);
    fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Tick ô xác nhận để đồng ý.',
    );
  });

  it('accepts exactly the shown versions, then returns to returnTo', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ success: true }));
    render(
      <ConsentForm
        mode="blocked"
        documents={DOCS}
        returnTo="/learn/lessons/12"
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    const submit = screen.getByRole('button', { name: 'Đồng ý và tiếp tục' });
    expect(submit).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(submit);
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('/learn/lessons/12'),
    );
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/learner/consents/accept');
    expect(JSON.parse(String(init?.body))).toEqual({
      documents: [{ type: 'terms', version: '2026-11-t', sha256: SHA }],
    });
  });

  it('asks to reload when the versions changed meanwhile', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'legal_documents_outdated' } },
        { status: 400 },
      ),
    );
    render(<ConsentForm mode="blocked" documents={DOCS} returnTo="/learn" />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Văn bản vừa được cập nhật. Tải lại trang để xem bản mới.',
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('"Để sau" still returns when sessionStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(
      <ConsentForm
        mode="pending"
        documents={[
          {
            ...DOCS[0]!,
            status: 'pending',
            deadline: '2026-12-01T00:00:00.000Z',
          },
        ]}
        returnTo="/learn/review"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
    expect(assign).toHaveBeenCalledWith('/learn/review');
  });
});

describe('ConsentPendingBanner (M1.7b2 B2a)', () => {
  const DEADLINE = '2026-12-01T00:00:00.000Z';

  it('shows the deadline and a link back to the current page', async () => {
    render(<ConsentPendingBanner deadline={DEADLINE} />);
    const banner = await screen.findByRole('region', {
      name: 'Điều khoản đã cập nhật',
    });
    expect(banner).toHaveTextContent('01/12/2026');
    expect(screen.getByRole('link', { name: 'Xem và đồng ý' })).toHaveAttribute(
      'href',
      '/consent?returnTo=%2Flearn%2Freview',
    );
  });

  it('stays out of the full-screen lesson flow', async () => {
    pathname.mockReturnValue('/learn/lessons/12');
    render(<ConsentPendingBanner deadline={DEADLINE} />);
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });

  it('"Để sau" hides it and remembers it for this tab', async () => {
    const { unmount } = render(<ConsentPendingBanner deadline={DEADLINE} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Để sau' }));
    expect(screen.queryByRole('region')).toBeNull();
    expect(window.sessionStorage.getItem(CONSENT_LATER_KEY)).toBe(DEADLINE);
    unmount();
    render(<ConsentPendingBanner deadline={DEADLINE} />);
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });

  it('"Để sau" still hides it when sessionStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<ConsentPendingBanner deadline={DEADLINE} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Để sau' }));
    expect(screen.queryByRole('region')).toBeNull();
  });
});
