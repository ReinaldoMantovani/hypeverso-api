import { ZodError, type ZodType } from 'zod';
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  return schema.parse(input);
}
export function isZodError(e: unknown): e is ZodError {
  return e instanceof ZodError;
}
