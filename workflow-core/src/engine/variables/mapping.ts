// Variable mapping for service-task input/output. As of Phase 2 the source
// is a real expression evaluated by src/engine/expressions, so things like
// `=variables.amount + 1` or `=variables.flag == true` are valid sources.
// The target is still a dotted path written into the job inputs (input
// mapping) or the instance variables (output mapping).

import { evaluate } from "../expressions";
import type { IoMapping, VariableMapping } from "../parser/types";

export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingError";
  }
}

export function applyInputMapping(
  mapping: IoMapping | undefined,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  if (!mapping || mapping.inputs.length === 0) {
    return { ...variables };
  }
  const result: Record<string, unknown> = {};
  for (const m of mapping.inputs) {
    const value = evaluate(m.source, { variables });
    setPath(result, m.target, value);
  }
  return result;
}

export function applyOutputMapping(
  mapping: IoMapping | undefined,
  result: Record<string, unknown> | undefined,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  if (!result) return variables;

  if (!mapping || mapping.outputs.length === 0) {
    return { ...variables, ...result };
  }

  const next = { ...variables };
  for (const m of mapping.outputs) {
    const value = evaluate(m.source, { result, variables });
    if (!m.target.startsWith("variables.")) {
      throw new MappingError(
        `Output mapping target must start with "variables." (got ${m.target})`,
      );
    }
    const path = m.target.slice("variables.".length);
    setPath(next, path, value);
  }
  return next;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const segment = parts[i]!;
    const next = cursor[segment];
    if (next == null || typeof next !== "object" || Array.isArray(next)) {
      const fresh: Record<string, unknown> = {};
      cursor[segment] = fresh;
      cursor = fresh;
    } else {
      cursor = next as Record<string, unknown>;
    }
  }
  cursor[parts[parts.length - 1]!] = value;
}

export type { IoMapping, VariableMapping };
