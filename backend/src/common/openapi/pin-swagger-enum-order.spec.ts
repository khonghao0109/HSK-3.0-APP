import { PinSwaggerEnumOrder } from './pin-swagger-enum-order';

describe('PinSwaggerEnumOrder', () => {
  const SCHEMA_ORDER = ['not_started', 'learning', 'done'] as const;

  it('rewrites the enum order of the pinned property', () => {
    @PinSwaggerEnumOrder('status', SCHEMA_ORDER)
    class Pinned {
      static _OPENAPI_METADATA_FACTORY = () => ({
        status: { enum: ['done', 'learning', 'not_started'] },
        name: { type: 'string' },
      });
    }

    expect(Pinned._OPENAPI_METADATA_FACTORY()).toEqual({
      status: { enum: ['not_started', 'learning', 'done'] },
      name: { type: 'string' },
    });
  });

  it('keeps the original factory when the class has none', () => {
    @PinSwaggerEnumOrder('status', SCHEMA_ORDER)
    class NoFactory {}

    const ctor = NoFactory as { _OPENAPI_METADATA_FACTORY?: unknown };
    expect(ctor._OPENAPI_METADATA_FACTORY).toBeUndefined();
  });

  it('does not touch a property that has no enum', () => {
    @PinSwaggerEnumOrder('status', SCHEMA_ORDER)
    class NoEnum {
      static _OPENAPI_METADATA_FACTORY = () => ({
        status: { type: 'string' },
      });
    }

    expect(NoEnum._OPENAPI_METADATA_FACTORY()).toEqual({
      status: { type: 'string' },
    });
  });

  it('does not touch an enum on another property', () => {
    @PinSwaggerEnumOrder('status', SCHEMA_ORDER)
    class OtherEnum {
      static _OPENAPI_METADATA_FACTORY = () => ({
        type: { enum: ['done', 'learning', 'not_started'] },
      });
    }

    expect(OtherEnum._OPENAPI_METADATA_FACTORY()).toEqual({
      type: { enum: ['done', 'learning', 'not_started'] },
    });
  });
});
