import { describe, expect, it, vi } from 'vitest';

import { selectGlobalErrorRecovery } from './global-error';

describe('global error recovery', () => {
  it('prefers the router recovery action so Server Components are fetched again', () => {
    const reset = vi.fn();
    const retry = vi.fn();

    selectGlobalErrorRecovery({ reset, retry })();

    expect(retry).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
  });

  it('supports the current unstable retry contract when it is provided', () => {
    const reset = vi.fn();
    const retry = vi.fn();
    const unstableRetry = vi.fn();

    selectGlobalErrorRecovery({ reset, retry, unstableRetry })();

    expect(unstableRetry).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it('falls back to resetting the boundary for older runtimes', () => {
    const reset = vi.fn();

    selectGlobalErrorRecovery({ reset })();

    expect(reset).toHaveBeenCalledOnce();
  });
});
