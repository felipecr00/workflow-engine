// Derives a JSON Schema from a form-js schema, then validates a payload of
// task variables against it using AJV. This is the server-side validation
// path: the frontend already validates inside @bpmn-io/form-js, but we never
// trust the client. Sprint 1 supports a fixed subset of form-js component
// types; deploying a form with an unsupported type fails fast.

import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

// ── Public types ────────────────────────────────────────────

export interface FormJsComponent {
  type: string;
  key?: string;
  label?: string;
  validate?: Record<string, unknown>;
  values?: Array<{ value: string; label?: string }>;
  subtype?: string;
  // Other fields exist (description, defaultValue, etc.) but we don't
  // need them for derivation — they only affect rendering or initial
  // state.
  [extra: string]: unknown;
}

export interface FormJsSchema {
  type?: string;
  components?: FormJsComponent[];
  // form-js also has a top-level `schemaVersion` and `exporter`, both
  // ignored for derivation.
  [extra: string]: unknown;
}

export interface UnsupportedFieldError {
  field: string;
  type: string;
}

export class UnsupportedFormFieldError extends Error {
  constructor(public readonly details: UnsupportedFieldError) {
    super(
      `Unsupported form-js component type "${details.type}" for field "${details.field}"`,
    );
    this.name = "UnsupportedFormFieldError";
  }
}

export interface ValidationFailure {
  path: string;
  message: string;
}

// ── Component classification ────────────────────────────────

// Components that do NOT carry data — purely presentational. These are
// allowed in a deployed form but contribute nothing to the JSON Schema.
const PRESENTATIONAL_TYPES = new Set([
  "text",
  "html",
  "image",
  "spacer",
  "separator",
  "button",
]);

// Data-bearing component types we support in Sprint 1. Anything else (group,
// dynamiclist, iframe, table, etc.) is rejected at deploy time.
const DATA_TYPES = new Set([
  "textfield",
  "textarea",
  "number",
  "checkbox",
  "datetime",
  "select",
  "radio",
  "taglist",
  "checklist",
]);

// ── Derive a JSON Schema ────────────────────────────────────

export function deriveJsonSchema(form: FormJsSchema): Record<string, unknown> {
  const components = form.components ?? [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const c of components) {
    if (PRESENTATIONAL_TYPES.has(c.type)) continue;

    if (!DATA_TYPES.has(c.type)) {
      throw new UnsupportedFormFieldError({
        field: c.key ?? "(no key)",
        type: c.type,
      });
    }

    if (!c.key) {
      throw new UnsupportedFormFieldError({
        field: "(unnamed)",
        type: c.type,
      });
    }

    properties[c.key] = derivePropertySchema(c);

    if (c.validate && typeof c.validate === "object") {
      const isRequired = (c.validate as Record<string, unknown>).required === true;
      if (isRequired) required.push(c.key);
    }
  }

  const jsonSchema: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: true,
  };
  if (required.length > 0) jsonSchema.required = required;
  return jsonSchema;
}

function derivePropertySchema(c: FormJsComponent): Record<string, unknown> {
  const validate = (c.validate as Record<string, unknown> | undefined) ?? {};

  switch (c.type) {
    case "textfield":
    case "textarea": {
      const out: Record<string, unknown> = { type: "string" };
      if (typeof validate.minLength === "number") out.minLength = validate.minLength;
      if (typeof validate.maxLength === "number") out.maxLength = validate.maxLength;
      if (typeof validate.pattern === "string") out.pattern = validate.pattern;
      return out;
    }
    case "number": {
      const out: Record<string, unknown> = { type: "number" };
      if (typeof validate.min === "number") out.minimum = validate.min;
      if (typeof validate.max === "number") out.maximum = validate.max;
      return out;
    }
    case "checkbox":
      return { type: "boolean" };
    case "datetime": {
      // form-js datetime has subtype "date" | "time" | "datetime". JSON
      // Schema's "date-time" and "date" formats cover the common cases;
      // a missing subtype defaults to date-time.
      const subtype = typeof c.subtype === "string" ? c.subtype : "datetime";
      const format =
        subtype === "date" ? "date" : subtype === "time" ? "time" : "date-time";
      return { type: "string", format };
    }
    case "select":
    case "radio": {
      const enumValues = (c.values ?? [])
        .map((v) => v.value)
        .filter((v): v is string => typeof v === "string");
      const out: Record<string, unknown> = { type: "string" };
      if (enumValues.length > 0) out.enum = enumValues;
      return out;
    }
    case "taglist":
    case "checklist": {
      const enumValues = (c.values ?? [])
        .map((v) => v.value)
        .filter((v): v is string => typeof v === "string");
      const items: Record<string, unknown> = { type: "string" };
      if (enumValues.length > 0) items.enum = enumValues;
      return { type: "array", items };
    }
    default:
      // Already filtered above, but keep a hard fallback for safety.
      throw new UnsupportedFormFieldError({
        field: c.key ?? "(no key)",
        type: c.type,
      });
  }
}

// ── Validate a payload ──────────────────────────────────────

// AJV is cheap to construct, but we don't need a new one per call. Sharing
// a single instance is safe because each compiled validator is stateless.
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export function validateAgainstForm(
  form: FormJsSchema,
  variables: Record<string, unknown>,
): { valid: true } | { valid: false; errors: ValidationFailure[] } {
  const schema = deriveJsonSchema(form);
  const validate = ajv.compile(schema);
  const ok = validate(variables);
  if (ok) return { valid: true };
  return {
    valid: false,
    errors: (validate.errors ?? []).map(formatError),
  };
}

function formatError(err: ErrorObject): ValidationFailure {
  // For "required", AJV puts the missing field in params.missingProperty and
  // leaves instancePath at the parent. Prefer the missing property as the
  // path so the frontend can highlight the right input.
  if (err.keyword === "required") {
    const missing = (err.params as { missingProperty?: string }).missingProperty;
    return {
      path: missing ? `/${missing}` : err.instancePath,
      message: missing ? `${missing} is required` : err.message ?? "required",
    };
  }
  return {
    path: err.instancePath || "/",
    message: err.message ?? err.keyword,
  };
}
