import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const SUPPORTED_LOCALES = ['vi-VN'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_USER_PROFILE = {
  displayName: null,
  locale: 'vi-VN',
  timezone: 'Asia/Ho_Chi_Minh',
} as const;

const BIDI_OVERRIDE_REGEX = /[\u202A-\u202E\u2066-\u2069]/u;
const CONTROL_CHAR_REGEX = /\p{Cc}/u;
const TIMEZONE_FORMAT_REGEX =
  /^(UTC|[A-Z][A-Za-z_]*(\/[A-Z][A-Za-z0-9_+-]*)+)$/;

export type ValidationResult<T> =
  | { valid: true; normalized: T }
  | { valid: false; error: string };

export function validateDisplayName(
  value: unknown,
): ValidationResult<string | null> {
  if (value === null) {
    return { valid: true, normalized: null };
  }
  if (typeof value !== 'string') {
    return { valid: false, error: 'displayName must be a string or null.' };
  }
  const trimmed = value.trim();
  const codePointLength = Array.from(trimmed).length;
  if (codePointLength < 1) {
    return {
      valid: false,
      error: 'displayName must not be empty after trimming.',
    };
  }
  if (codePointLength > 50) {
    return {
      valid: false,
      error: 'displayName must not exceed 50 characters.',
    };
  }
  if (CONTROL_CHAR_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: 'displayName must not contain control characters.',
    };
  }
  if (BIDI_OVERRIDE_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: 'displayName must not contain bidi override characters.',
    };
  }
  return { valid: true, normalized: trimmed };
}

export function validateLocale(
  value: unknown,
): ValidationResult<SupportedLocale> {
  if (typeof value !== 'string') {
    return { valid: false, error: 'locale must be a string.' };
  }
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(value)) {
    return {
      valid: false,
      error: `locale must be one of: ${SUPPORTED_LOCALES.join(', ')}.`,
    };
  }
  return { valid: true, normalized: value as SupportedLocale };
}

export function validateTimezone(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { valid: false, error: 'timezone must be a string.' };
  }
  if (value.length === 0 || value.length > 64) {
    return {
      valid: false,
      error: 'timezone length must be between 1 and 64 characters.',
    };
  }
  if (!TIMEZONE_FORMAT_REGEX.test(value)) {
    return {
      valid: false,
      error: 'timezone must match the standard IANA timezone format.',
    };
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return { valid: true, normalized: value };
  } catch {
    return {
      valid: false,
      error: 'timezone must be a valid IANA timezone identifier.',
    };
  }
}

@ValidatorConstraint({ name: 'isValidDisplayName', async: false })
export class IsValidDisplayNameConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return validateDisplayName(value).valid;
  }

  defaultMessage(args?: ValidationArguments): string {
    const result = validateDisplayName(args?.value);
    return result.valid ? 'Invalid displayName.' : result.error;
  }
}

@ValidatorConstraint({ name: 'isValidLocale', async: false })
export class IsValidLocaleConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return validateLocale(value).valid;
  }

  defaultMessage(args?: ValidationArguments): string {
    const result = validateLocale(args?.value);
    return result.valid ? 'Invalid locale.' : result.error;
  }
}

@ValidatorConstraint({ name: 'isValidTimezone', async: false })
export class IsValidTimezoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return validateTimezone(value).valid;
  }

  defaultMessage(args?: ValidationArguments): string {
    const result = validateTimezone(args?.value);
    return result.valid ? 'Invalid timezone.' : result.error;
  }
}
