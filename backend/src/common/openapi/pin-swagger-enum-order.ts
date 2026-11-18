/**
 * The Swagger CLI plugin bakes `enum` values from the TypeScript union in
 * checker order, which depends on which string-literal types were created
 * first elsewhere in the program. M4.5 B1 hit this: after `exam-list.model.ts`
 * started using a `'not_started'` literal, the generated `ProgressStatus`
 * enum flipped to checker order. Pin the runtime order from the Prisma enum
 * object (schema order) so `openapi.json` stays byte-identical regardless of
 * which other files are compiled.
 */
export function PinSwaggerEnumOrder(
  property: string,
  values: readonly string[],
): ClassDecorator {
  return (target) => {
    const ctor = target as {
      _OPENAPI_METADATA_FACTORY?: () => Record<string, unknown>;
    };
    const original = ctor._OPENAPI_METADATA_FACTORY;
    if (typeof original !== 'function') return;
    ctor._OPENAPI_METADATA_FACTORY = () => {
      const metadata = original();
      const entry = metadata[property];
      if (entry !== undefined && typeof entry === 'object') {
        const typed = entry as { enum?: readonly string[] };
        if ('enum' in typed) typed.enum = [...values];
      }
      return metadata;
    };
  };
}
