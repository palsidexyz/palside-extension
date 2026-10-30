const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

/** Advisory length, in user-perceived characters. Never truncates an IME draft. */
export function textLength(value: string) {
  let count = 0;
  for (const part of segmenter.segment(value)) {
    void part;
    count += 1;
  }
  return count;
}

export function lengthState(value: string, limit: number) {
  const maximum = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
  const count = textLength(value);
  return { count, maximum, exceeded: count > maximum, remaining: Math.max(0, maximum - count) };
}

export function describedBy(...ids: (string | undefined)[]) {
  const tokens = ids.flatMap((id) => id?.trim().split(/\s+/u).filter(Boolean) ?? []);
  return [...new Set(tokens)].join(" ") || undefined;
}
