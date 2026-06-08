// Tiny ISO 8601 duration parser supporting the subset we need for timer
// events: P[nD]T[nH][nM][nS]. Examples: PT5M, PT1H30M, P1DT12H, PT45S.
// Months and years are intentionally not supported — they have ambiguous
// length, and the timer use cases we care about are short-horizon.

export class DurationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DurationParseError";
  }
}

const RE = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function parseIsoDurationMs(input: string): number {
  const trimmed = input.trim();
  const match = RE.exec(trimmed);
  if (!match) {
    throw new DurationParseError(`Invalid ISO 8601 duration: "${input}"`);
  }
  const [, days, hours, minutes, seconds] = match;
  if (!days && !hours && !minutes && !seconds) {
    throw new DurationParseError(`Empty ISO 8601 duration: "${input}"`);
  }
  const ms =
    (Number(days ?? 0) * 24 * 60 * 60 * 1000) +
    (Number(hours ?? 0) * 60 * 60 * 1000) +
    (Number(minutes ?? 0) * 60 * 1000) +
    (Number(seconds ?? 0) * 1000);
  return Math.round(ms);
}

export function computeTimerDueAt(
  kind: "duration" | "date",
  expression: string,
  now: Date = new Date(),
): Date {
  if (kind === "duration") {
    const ms = parseIsoDurationMs(expression);
    return new Date(now.getTime() + ms);
  }
  const date = new Date(expression);
  if (Number.isNaN(date.getTime())) {
    throw new DurationParseError(`Invalid ISO 8601 date: "${expression}"`);
  }
  return date;
}
