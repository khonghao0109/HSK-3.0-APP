import { Transform } from 'class-transformer';
import { IsBoolean, ValidationOptions } from 'class-validator';

export function IsStrictBoolean(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    Transform(
      ({ obj, key }: { obj: unknown; key: string }) =>
        isRecord(obj) ? obj[key] : undefined,
      { toClassOnly: true },
    )(target, propertyKey);
    IsBoolean({
      message: `${String(propertyKey)} must be a JSON boolean`,
      ...validationOptions,
    })(target, propertyKey);
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
