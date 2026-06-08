import { tokenize, TokenizeError, type Token, type TokenKind } from "./tokenizer";

export type Node =
  | { kind: "literal"; value: number | string | boolean | null }
  | { kind: "path"; segments: string[] }
  | { kind: "unary"; op: "not" | "neg"; arg: Node }
  | {
      kind: "binary";
      op:
        | "eq"
        | "neq"
        | "lt"
        | "lte"
        | "gt"
        | "gte"
        | "and"
        | "or"
        | "add"
        | "sub";
      left: Node;
      right: Node;
    };

export class ParseError extends Error {
  constructor(message: string, public readonly pos: number) {
    super(`${message} (at position ${pos})`);
    this.name = "ExpressionParseError";
  }
}

export function parseExpression(src: string): Node {
  const tokens = tokenize(src);
  const parser = new Parser(tokens);
  const node = parser.parseOr();
  parser.expect("eof");
  return node;
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.i]!;
  }

  private eat(): Token {
    return this.tokens[this.i++]!;
  }

  private match(...kinds: TokenKind[]): Token | null {
    if (kinds.includes(this.peek().kind)) return this.eat();
    return null;
  }

  expect(kind: TokenKind): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new ParseError(`Expected ${kind}, got ${t.kind}`, t.pos);
    }
    return this.eat();
  }

  parseOr(): Node {
    let node = this.parseAnd();
    while (this.match("or")) {
      const right = this.parseAnd();
      node = { kind: "binary", op: "or", left: node, right };
    }
    return node;
  }

  parseAnd(): Node {
    let node = this.parseEquality();
    while (this.match("and")) {
      const right = this.parseEquality();
      node = { kind: "binary", op: "and", left: node, right };
    }
    return node;
  }

  parseEquality(): Node {
    let node = this.parseCompare();
    while (true) {
      if (this.match("eq")) {
        node = { kind: "binary", op: "eq", left: node, right: this.parseCompare() };
      } else if (this.match("neq")) {
        node = { kind: "binary", op: "neq", left: node, right: this.parseCompare() };
      } else break;
    }
    return node;
  }

  parseCompare(): Node {
    let node = this.parseAdditive();
    while (true) {
      const t = this.peek();
      if (t.kind === "lt" || t.kind === "lte" || t.kind === "gt" || t.kind === "gte") {
        this.eat();
        node = { kind: "binary", op: t.kind, left: node, right: this.parseAdditive() };
      } else break;
    }
    return node;
  }

  parseAdditive(): Node {
    let node = this.parseUnary();
    while (true) {
      if (this.match("plus")) {
        node = { kind: "binary", op: "add", left: node, right: this.parseUnary() };
      } else if (this.match("minus")) {
        node = { kind: "binary", op: "sub", left: node, right: this.parseUnary() };
      } else break;
    }
    return node;
  }

  parseUnary(): Node {
    if (this.match("not")) return { kind: "unary", op: "not", arg: this.parseUnary() };
    if (this.match("minus")) return { kind: "unary", op: "neg", arg: this.parseUnary() };
    return this.parsePrimary();
  }

  parsePrimary(): Node {
    const t = this.peek();
    if (t.kind === "number") {
      this.eat();
      return { kind: "literal", value: t.value as number };
    }
    if (t.kind === "string") {
      this.eat();
      return { kind: "literal", value: t.value as string };
    }
    if (t.kind === "true") { this.eat(); return { kind: "literal", value: true }; }
    if (t.kind === "false") { this.eat(); return { kind: "literal", value: false }; }
    if (t.kind === "null") { this.eat(); return { kind: "literal", value: null }; }
    if (t.kind === "lparen") {
      this.eat();
      const node = this.parseOr();
      this.expect("rparen");
      return node;
    }
    if (t.kind === "ident") {
      this.eat();
      const segments: string[] = [t.value as string];
      while (this.match("dot")) {
        const next = this.expect("ident");
        segments.push(next.value as string);
      }
      return { kind: "path", segments };
    }
    throw new ParseError(`Unexpected token ${t.kind}`, t.pos);
  }
}

export { TokenizeError };
