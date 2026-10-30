import Type, { type StaticDecode as Static, type TProperties, type TSchema, type TSchemaOptions } from 'typebox';
import { Value, DecodeUnsafe } from 'typebox/value';
import type { TLocalizedValidationError } from 'typebox/error';
import { graphemeLength } from './rules.ts';

export { graphemeLength } from './rules.ts';

export { default as Type } from 'typebox';
export type { StaticDecode as Infer } from 'typebox';
export type Path = readonly (string | number)[];

export class ContractDecodeError extends Error {
  readonly path: Path;
  constructor(path: Path, expectation: string) {
    super(`${path.reduce<string>((value, part) => typeof part === 'number' ? `${value}[${part}]` : `${value}.${part}`, '$')}: ${expectation}`);
    this.name = 'ContractDecodeError'; this.path = [...path];
  }
}

function errorPath(error: TLocalizedValidationError, input: unknown): Path {
  const path: (string | number)[] = [];
  let current = input;
  for (const escaped of error.instancePath.split('/').slice(1)) {
    const key = escaped.replace(/~1/g, '/').replace(/~0/g, '~');
    path.push(Array.isArray(current) ? Number(key) : key);
    current = current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined;
  }
  if (error.keyword === 'required') path.push(error.params.requiredProperties[0]!);
  if (error.keyword === 'additionalProperties') path.push(error.params.additionalProperties[0]!);
  if (error.keyword === '~refine' && Array.isArray(current)) {
    const missing = current.findIndex((_, index) => !Object.hasOwn(current, index));
    if (missing !== -1) path.push(missing);
  }
  return path;
}

/** Select diagnostics in declaration order; unions retain the deepest failing variant. */
function failure(schema: TSchema, errors: TLocalizedValidationError[], input: unknown, prefix = '#', instancePath = ''): TLocalizedValidationError {
  const own = errors.filter(error => error.schemaPath === prefix);
  if (Type.IsUnion(schema)) {
    const value = instancePath.split('/').slice(1).reduce<unknown>((value, key) =>
      (value as Record<string, unknown>)[key.replace(/~1/g, '/').replace(/~0/g, '~')], input);
    const candidates = schema.anyOf.flatMap((choice, index) => {
      const branch = `${prefix}/anyOf/${index}`;
      // Collect per variant so TypeBox's diagnostic cap cannot hide a deeper variant's path.
      const nested = Value.Errors(choice, value).map(error => ({ ...error, schemaPath: branch + error.schemaPath.slice(1), instancePath: instancePath + error.instancePath }));
      return nested.length ? [failure(choice, nested, input, branch, instancePath)] : [];
    });
    return candidates.reduce((best, error) => errorPath(error, input).length > errorPath(best, input).length ? error : best, candidates[0] ?? own[0] ?? errors[0]!);
  }
  const extra = own.find(error => error.keyword === 'additionalProperties') ?? errors.find(error => error.schemaPath === `${prefix}/additionalProperties`);
  if (extra) return extra;
  const size = own.find(error => error.keyword === 'maxItems' || error.keyword === 'minItems' || error.keyword === 'maxProperties');
  if (size) return size;
  if (Type.IsObject(schema)) {
    for (const [key, property] of Object.entries(schema.properties)) {
      const required = own.find(error => error.keyword === 'required' && error.params.requiredProperties.includes(key));
      if (required?.keyword === 'required') return { ...required, params: { requiredProperties: [key] } };
      const branch = `${prefix}/properties/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      const nested = errors.filter(error => error.schemaPath === branch || error.schemaPath.startsWith(`${branch}/`));
      if (nested.length) return failure(property, nested, input, branch, `${instancePath}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    }
  }
  const itemSchema = Type.IsArray(schema) ? schema.items : Type.IsRecord(schema) ? Type.RecordValue(schema) : undefined;
  const itemPrefix = Type.IsArray(schema) ? `${prefix}/items` : Type.IsRecord(schema) ? `${prefix}/patternProperties/${Type.RecordPattern(schema)}` : '';
  if (itemSchema) {
    const nested = errors.filter(error => error.schemaPath === itemPrefix || error.schemaPath.startsWith(`${itemPrefix}/`));
    if (nested.length) {
      // Errors from later array/record entries must not precede the first invalid entry.
      const first = nested[0]!.instancePath;
      const entry = `${instancePath}/${first.slice(instancePath.length + 1).split('/')[0]}`;
      return failure(itemSchema, nested.filter(error => error.instancePath === entry || error.instancePath.startsWith(`${entry}/`)), input, itemPrefix, entry);
    }
  }
  return errors[0]!;
}

// Codecs may write child properties. Copy data without dropping record keys such as __proto__.
function copyInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyInput);
  if (value && typeof value === 'object' && isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyInput(item)]));
  return value;
}

/** Strict boundary decoder. All checks and Codec traversal use TypeBox's CSP-safe interpreter.
 * decodeContract checks input once, rejects coercion and extra fields, then applies Codecs to a copy.
 */
export function decodeContract<S extends TSchema>(schema: S, input: unknown, path: Path = []): Static<S> {
  if (!Value.Check(schema, input)) {
    // Tagged errors report the selected code's fields, including for large error unions.
    const discriminator = (schema as TSchema & { discriminator?: string }).discriminator;
    const diagnostic = Type.IsUnion(schema) && discriminator && input && typeof input === 'object' && !Array.isArray(input)
      ? schema.anyOf.find(choice => Type.IsObject(choice) && Type.IsLiteral(choice.properties[discriminator]) && choice.properties[discriminator].const === (input as Record<string, unknown>)[discriminator])
        ?? Type.Object({ [discriminator]: Type.Never() })
      : schema;
    const error = failure(diagnostic, Value.Errors(diagnostic, input), input);
    const message = error.keyword === 'maxItems' || error.keyword === 'maxProperties' ? `expected at most ${error.params.limit} entries` : error.keyword === 'additionalProperties' || error.schemaPath.endsWith('/additionalProperties') ? 'unexpected field' : error.message;
    throw new ContractDecodeError([...path, ...errorPath(error, input)], message);
  }
  return DecodeUnsafe({}, schema, copyInput(input)) as Static<S>;
}

/** Contract strings explicitly distinguish UTF-16, code points and visible characters. */
export function contractString({ min = 0, max = Infinity, unit = 'utf16', trim = false, pattern, normalize }: {
  min?: number; max?: number; unit?: 'utf16' | 'codePoint' | 'grapheme'; trim?: boolean; pattern?: RegExp;
  normalize?: (value: string) => string;
} = {}) {
  const normalized = normalize ?? (trim ? (value: string) => value.trim() : (value: string) => value);
  const expression = pattern && new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
  const schema = Type.Refine(Type.String(), input => {
    const value = normalized(input);
    const length = unit === 'grapheme' ? graphemeLength(value) : unit === 'codePoint' ? [...value].length : value.length;
    return length >= min && length <= max && (!expression || expression.test(value));
  }, () => `expected length ${min}..${max} (${unit})${pattern ? ' and string format' : ''}`);
  return Type.Decode(schema, normalized);
}

export function safeInteger(options: { minimum?: number; maximum?: number } = {}) {
  return Type.Integer({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER, ...options });
}

const isPlainObject = (value: object) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
/** JSON objects reject class instances and omit explicitly undefined optional properties. */
export function strictObject<P extends TProperties>(properties: P) {
  return Type.Decode(Type.Refine(Type.Object(properties, { additionalProperties: false }), isPlainObject, () => 'expected object'),
    value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as keyof P extends never ? Record<never, never> : Static<Type.TObject<P>>);
}
export function plainRecord<S extends TSchema>(values: S, options: TSchemaOptions = {}) {
  return Type.Decode(Type.Refine(Type.Record(Type.String(), values, options), isPlainObject, () => 'expected object'),
    value => Object.fromEntries(Object.entries(value)) as Record<string, Static<S>>);
}

/** Binary HTTP bodies are Uint8Array values (including Node Buffers), with a byte cap. */
export function binaryBody(maximum = Infinity, minimum = 0) {
  return Type.Refine(Type.Unsafe<Uint8Array>({}), value => value instanceof Uint8Array && value.byteLength >= minimum && value.byteLength <= maximum,
    () => `expected binary body of at most ${maximum} bytes`);
}

/** Sparse arrays cannot cross a JSON contract boundary as missing items. */
export function denseArray<S extends TSchema>(items: S, options: TSchemaOptions = {}) {
  return Type.Refine(Type.Array(items, options), value => value.findIndex((_, index) => !Object.hasOwn(value, index)) === -1,
    value => `[${value.findIndex((_, index) => !Object.hasOwn(value, index))}]: expected array item`);
}
