import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { IsStrictBoolean } from './is-strict-boolean.decorator';

class StrictBooleanProbe {
  @IsStrictBoolean()
  enabled!: boolean;
}

describe('IsStrictBoolean', () => {
  it.each([false, true])('accepts JSON boolean %s', (value) => {
    const instance = plainToInstance(
      StrictBooleanProbe,
      { enabled: value },
      { enableImplicitConversion: true },
    );
    expect(validateSync(instance)).toEqual([]);
    expect(instance.enabled).toBe(value);
  });

  it.each(['false', 'true', 0, 1, null, {}, []])(
    'rejects non-boolean value %p despite implicit conversion',
    (value) => {
      const instance = plainToInstance(
        StrictBooleanProbe,
        { enabled: value },
        { enableImplicitConversion: true },
      );
      expect(validateSync(instance)).toHaveLength(1);
    },
  );
});
