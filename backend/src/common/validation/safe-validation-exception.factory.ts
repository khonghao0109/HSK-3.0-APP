import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';

type SafeValidationError = {
  path: string;
  codes: string[];
};

export function createSafeValidationException(
  errors: ValidationError[],
): BadRequestException {
  const safeErrors = errors.flatMap((error) => flattenValidationError(error));
  return new BadRequestException({
    code: 'REQUEST_VALIDATION_FAILED',
    message: 'Request validation failed.',
    errors:
      safeErrors.length > 0
        ? safeErrors
        : [{ path: '$', codes: ['invalid_request'] }],
  });
}

function flattenValidationError(
  error: ValidationError,
  parentPath = '$',
): SafeValidationError[] {
  const codes = Object.keys(error.constraints ?? {}).sort();
  const isUnknown = codes.includes('whitelistValidation');
  const path = isUnknown
    ? `${parentPath}.$unknown`
    : joinSafePath(parentPath, error.property);
  const current = codes.length > 0 ? [{ path, codes }] : [];
  return [
    ...current,
    ...(error.children ?? []).flatMap((child) =>
      flattenValidationError(child, path),
    ),
  ];
}

function joinSafePath(parentPath: string, property: string): string {
  const safeProperty = property.replace(/[^A-Za-z0-9_]/gu, '').slice(0, 64);
  return safeProperty.length > 0 ? `${parentPath}.${safeProperty}` : parentPath;
}
