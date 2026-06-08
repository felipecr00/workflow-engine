import { describe, expect, it } from "vitest";
import { evaluate, evaluateBoolean, EvaluationError } from "../src/engine";

describe("expression evaluator", () => {
  const scope = {
    variables: {
      approved: true,
      amount: 250,
      status: "shipped",
      order: { items: 3, total: 99.5 },
    },
  };

  it("evaluates literals", () => {
    expect(evaluate("=42", scope)).toBe(42);
    expect(evaluate("=3.14", scope)).toBe(3.14);
    expect(evaluate('="hi"', scope)).toBe("hi");
    expect(evaluate("=true", scope)).toBe(true);
    expect(evaluate("=null", scope)).toBe(null);
  });

  it("evaluates path lookups", () => {
    expect(evaluate("=variables.approved", scope)).toBe(true);
    expect(evaluate("=variables.order.items", scope)).toBe(3);
    expect(evaluate("=variables.missing", scope)).toBeUndefined();
  });

  it("supports bareword shorthand for variables", () => {
    expect(evaluate("=approved", scope)).toBe(true);
    expect(evaluate("=order.total", scope)).toBe(99.5);
  });

  it("evaluates equality and comparison", () => {
    expect(evaluateBoolean("=variables.status == \"shipped\"", scope)).toBe(true);
    expect(evaluateBoolean("=variables.status != \"shipped\"", scope)).toBe(false);
    expect(evaluateBoolean("=variables.amount > 100", scope)).toBe(true);
    expect(evaluateBoolean("=variables.amount <= 250", scope)).toBe(true);
  });

  it("evaluates logical operators with short-circuit", () => {
    let touched = false;
    const trickyScope = {
      variables: {
        get sideEffect() {
          touched = true;
          return true;
        },
        approved: false,
      },
    };
    // Short-circuit: false && X should not evaluate X
    expect(
      evaluateBoolean("=variables.approved && variables.sideEffect", trickyScope),
    ).toBe(false);
    expect(touched).toBe(false);

    expect(evaluateBoolean('=variables.amount > 100 && variables.status == "shipped"', scope)).toBe(true);
    expect(evaluateBoolean("=variables.amount > 1000 || variables.approved", scope)).toBe(true);
  });

  it("supports unary not and arithmetic", () => {
    expect(evaluateBoolean("=!variables.approved", scope)).toBe(false);
    expect(evaluate("=variables.amount + 50", scope)).toBe(300);
    expect(evaluate("=variables.amount - 50", scope)).toBe(200);
    expect(evaluate('="hello, " + variables.status', scope)).toBe("hello, shipped");
  });

  it("respects parentheses and precedence", () => {
    expect(
      evaluate("=(variables.amount + 50) > 100 && !false", scope),
    ).toBe(true);
  });

  it("rejects malformed expressions", () => {
    expect(() => evaluate("=", scope)).toThrow(EvaluationError);
    expect(() => evaluate("not-an-expr", scope)).toThrow(EvaluationError);
    expect(() => evaluate("=variables.amount + ", scope)).toThrow();
  });
});
