export type TokenKind =
  | "number"
  | "string"
  | "ident"
  | "true"
  | "false"
  | "null"
  | "dot"
  | "lparen"
  | "rparen"
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "and"
  | "or"
  | "not"
  | "plus"
  | "minus"
  | "eof";

export interface Token {
  kind: TokenKind;
  value?: string | number;
  pos: number;
}

export class TokenizeError extends Error {
  constructor(message: string, public readonly pos: number) {
    super(`${message} (at position ${pos})`);
    this.name = "TokenizeError";
  }
}

const WHITESPACE = /\s/;

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i]!;

    if (WHITESPACE.test(ch)) {
      i++;
      continue;
    }

    if (ch === "(") { tokens.push({ kind: "lparen", pos: i }); i++; continue; }
    if (ch === ")") { tokens.push({ kind: "rparen", pos: i }); i++; continue; }
    if (ch === ".") { tokens.push({ kind: "dot", pos: i }); i++; continue; }
    if (ch === "+") { tokens.push({ kind: "plus", pos: i }); i++; continue; }
    if (ch === "-") { tokens.push({ kind: "minus", pos: i }); i++; continue; }

    if (ch === "=") {
      if (src[i + 1] === "=") {
        tokens.push({ kind: "eq", pos: i });
        i += 2;
      } else {
        tokens.push({ kind: "eq", pos: i });
        i++;
      }
      continue;
    }
    if (ch === "!" && src[i + 1] === "=") {
      tokens.push({ kind: "neq", pos: i });
      i += 2;
      continue;
    }
    if (ch === "<") {
      if (src[i + 1] === "=") { tokens.push({ kind: "lte", pos: i }); i += 2; }
      else { tokens.push({ kind: "lt", pos: i }); i++; }
      continue;
    }
    if (ch === ">") {
      if (src[i + 1] === "=") { tokens.push({ kind: "gte", pos: i }); i += 2; }
      else { tokens.push({ kind: "gt", pos: i }); i++; }
      continue;
    }
    if (ch === "&" && src[i + 1] === "&") {
      tokens.push({ kind: "and", pos: i }); i += 2; continue;
    }
    if (ch === "|" && src[i + 1] === "|") {
      tokens.push({ kind: "or", pos: i }); i += 2; continue;
    }
    if (ch === "!") {
      tokens.push({ kind: "not", pos: i }); i++; continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const startPos = i;
      i++;
      let buf = "";
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < src.length) {
          const next = src[i + 1]!;
          buf += next === "n" ? "\n" : next === "t" ? "\t" : next;
          i += 2;
        } else {
          buf += src[i];
          i++;
        }
      }
      if (i >= src.length) {
        throw new TokenizeError("Unterminated string literal", startPos);
      }
      i++; // closing quote
      tokens.push({ kind: "string", value: buf, pos: startPos });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const startPos = i;
      let buf = "";
      while (i < src.length && /[0-9]/.test(src[i]!)) {
        buf += src[i];
        i++;
      }
      if (src[i] === "." && i + 1 < src.length && /[0-9]/.test(src[i + 1]!)) {
        buf += ".";
        i++;
        while (i < src.length && /[0-9]/.test(src[i]!)) {
          buf += src[i];
          i++;
        }
      }
      tokens.push({ kind: "number", value: parseFloat(buf), pos: startPos });
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const startPos = i;
      let buf = "";
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) {
        buf += src[i];
        i++;
      }
      if (buf === "true") tokens.push({ kind: "true", pos: startPos });
      else if (buf === "false") tokens.push({ kind: "false", pos: startPos });
      else if (buf === "null") tokens.push({ kind: "null", pos: startPos });
      else if (buf === "and") tokens.push({ kind: "and", pos: startPos });
      else if (buf === "or") tokens.push({ kind: "or", pos: startPos });
      else if (buf === "not") tokens.push({ kind: "not", pos: startPos });
      else tokens.push({ kind: "ident", value: buf, pos: startPos });
      continue;
    }

    throw new TokenizeError(`Unexpected character '${ch}'`, i);
  }

  tokens.push({ kind: "eof", pos: src.length });
  return tokens;
}
