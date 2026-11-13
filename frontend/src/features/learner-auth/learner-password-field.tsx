'use client';

import { type Ref, useState } from 'react';

export interface LearnerPasswordFieldProps {
  autoComplete: 'new-password' | 'current-password';
  invalid?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
}

export function LearnerPasswordField({
  autoComplete,
  invalid = false,
  inputRef,
  disabled = false,
  label = 'Mật khẩu',
  placeholder = 'Nhập mật khẩu',
}: LearnerPasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="field">
      <label className="field__label" htmlFor="password">
        {label}
      </label>
      <div className="input-wrap">
        <svg className="icon" aria-hidden="true">
          <use href="#i-lock" />
        </svg>
        <input
          ref={inputRef}
          className="input input--icon-end"
          id="password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete={autoComplete}
          minLength={6}
          placeholder={placeholder}
          aria-describedby="auth-alert"
          aria-invalid={invalid ? 'true' : undefined}
          disabled={disabled}
          required
        />
        <button
          className="icon-btn"
          type="button"
          aria-pressed={showPassword}
          aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          onClick={() => setShowPassword((prev) => !prev)}
        >
          <svg className="icon" aria-hidden="true">
            <use href={showPassword ? '#i-eye-off' : '#i-eye'} />
          </svg>
        </button>
      </div>
    </div>
  );
}
