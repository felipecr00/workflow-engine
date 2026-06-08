import { parseExpression, type Node } from "./parser";

export class EvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionEvaluationError";
  }
}

export interface EvalScope {
  variables?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

const exprCache = new Map<string, Node>();

function compile(src: string): Node {
  let cached = exprCache.get(src);
  if (cached) return cached;
  cached = parseExpression(src);
  exprCache.set(src, cached);
  return cached;
}

// Expressions in BPMN attributes always begin with '='. The parser only sees
// what comes after.
export function stripLeadingEquals(src: string): string {
  if (!src.startsWith("=")) {
    throw new EvaluationError(`Expression must start with "=" (got ${src})`);
  }
  const expr = src.slice(1).trim();
  if (expr.length === 0) {
    throw new EvaluationError("Empty expression after '='");
  }
  return expr;
}

export function evaluate(src: string, scope: EvalScope): unknown {
  const inner = stripLeadingEquals(src);
  const ast = compile(inner);
  return evaluateAst(ast, scope);
}

export function evaluateBoolean(src: string, scope: EvalScope): boolean {
  const v = evaluate(src, scope);
  return truthy(v);
}

function evaluateAst(node: Node, scope: EvalScope): unknown {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "path":
      return resolvePath(node.segments, scope);
    case "unary":
      if (node.op === "not") return !truthy(evaluateAst(node.arg, scope));
      if (node.op === "neg") {
        const v = evaluateAst(node.arg, scope);
        if (typeof v !== "number") {
          throw new EvaluationError(`Unary '-' requires a number, got ${typeOf(v)}`);
        }
        return -v;
      }
      throw new EvaluationError(`Unknown unary op ${(node as { op: string }).op}`);
    case "binary": {
      if (node.op === "and") {
        const l = evaluateAst(node.left, scope);
        if (!truthy(l)) return false;
        return truthy(evaluateAst(node.right, scope));
      }
      if (node.op === "or") {
        const l = evaluateAst(node.left, scope);
        if (truthy(l)) return true;
        return truthy(evaluateAst(node.right, scope));
      }
      const l = evaluateAst(node.left, scope);
      const r = evaluateAst(node.right, scope);
      switch (node.op) {
        case "eq":
          return strictEquals(l, r);
        case "neq":
          return !strictEquals(l, r);
        case "lt":
          return compare(l, r) < 0;
        case "lte":
          return compare(l, r) <= 0;
        case "gt":
          return compare(l, r) > 0;
        case "gte":
          return compare(l, r) >= 0;
        case "add": {
          if (typeof l === "number" && typeof r === "number") return l + r;
          if (typeof l === "string" || typeof r === "string") return String(l) + String(r);
          throw new EvaluationError(`'+' requires two numbers or a string operand`);
        }
        case "sub": {
          if (typeof l !== "number" || typeof r !== "number") {
            throw new EvaluationError(`'-' requires two numbers`);
          }
          return l - r;
        }
        default:
          throw new EvaluationError(`Unknown binary op ${(node as { op: string }).op}`);
      }
    }
  }
}

function resolvePath(segments: string[], scope: EvalScope): unknown {
  if (segments.length === 0) return undefined;
  const head = segments[0]!;
  let cursor: unknown;
  if (head === "variables") {
    cursor = scope.variables ?? {};
  } else if (head === "result") {
    if (!scope.result) {
      throw new EvaluationError("'result' is only available in output mappings");
    }
    cursor = scope.result;
  } else if (scope.result && Object.prototype.hasOwnProperty.call(scope.result, head)) {
    cursor = (scope.result as Record<string, unknown>)[head];
  } else if (scope.variables && Object.prototype.hasOwnProperty.call(scope.variables, head)) {
    // Convenience: bare identifiers resolve against variables. Lets simple
    // conditions like "=approved" work alongside "=variables.approved".
    cursor = scope.variables[head];
  } else {
    cursor = undefined;
  }

  for (let i = 1; i < segments.length; i++) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segments[i]!];
  }
  return cursor;
}

function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v.length > 0;
  return true;
}

function strictEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Allow numeric/string nulls to be equal; otherwise strict.
  return false;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  throw new EvaluationError(
    `Cannot compare ${typeOf(a)} and ${typeOf(b)} with <, <=, >, >=`,
  );
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
