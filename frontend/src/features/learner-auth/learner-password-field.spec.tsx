import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { LearnerPasswordField } from './learner-password-field';

describe('LearnerPasswordField', () => {
  it('toggles password visibility updating input type, aria-pressed, and aria-label', async () => {
    render(<LearnerPasswordField autoComplete="new-password" />);
    const user = userEvent.setup();

    const passwordInput = screen.getByLabelText('Mật khẩu');
    const toggleButton = screen.getByRole('button', { name: 'Hiện mật khẩu' });

    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(passwordInput).toHaveAttribute('autoComplete', 'new-password');
    expect(toggleButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggleButton);

    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(toggleButton).toHaveAttribute('aria-pressed', 'true');
    expect(toggleButton).toHaveAttribute('aria-label', 'Ẩn mật khẩu');

    await user.click(toggleButton);

    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(toggleButton).toHaveAttribute('aria-pressed', 'false');
    expect(toggleButton).toHaveAttribute('aria-label', 'Hiện mật khẩu');
  });

  it('attaches inputRef and sets aria-invalid attribute when invalid', () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <LearnerPasswordField
        autoComplete="current-password"
        invalid={true}
        inputRef={ref}
      />,
    );

    const passwordInput = screen.getByLabelText('Mật khẩu');
    expect(passwordInput).toHaveAttribute('aria-invalid', 'true');
    expect(ref.current).toBe(passwordInput);
  });

  it('enforces minLength 6 and required attribute', () => {
    render(<LearnerPasswordField autoComplete="new-password" />);
    const passwordInput = screen.getByLabelText('Mật khẩu');
    expect(passwordInput).toHaveAttribute('minLength', '6');
    expect(passwordInput).toHaveAttribute('required');
  });
});
