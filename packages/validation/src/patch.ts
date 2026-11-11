import { z } from 'zod';

/**
 * Removes field defaults from a `.partial()` object schema so a PATCH leaves omitted fields untouched.
 * Zod 4 still applies `.default()` inside `.optional()`, which would silently reset e.g. a lead's status,
 * tags or custom fields on a single-field update. Types are unchanged (every key is already optional).
 */
export function withoutDefaults<T extends z.ZodObject>(schema: T): T {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    let inner: z.ZodType = field instanceof z.ZodOptional ? (field.unwrap() as z.ZodType) : field;
    while (inner instanceof z.ZodDefault) inner = inner.unwrap() as z.ZodType;
    shape[key] = inner.optional();
  }
  return z.object(shape) as unknown as T;
}
