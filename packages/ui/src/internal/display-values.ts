/** Grapheme segmentation keeps CJK, combining marks and emoji intact. */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
  const segments = (value: string) => Array.from(segmenter.segment(value), (part) => part.segment);
  const selected = words.length > 1
    ? [segments(words[0] ?? "")[0], segments(words.at(-1) ?? "")[0]].join("")
    : segments(words[0] ?? "").slice(0, 2).join("");
  return segments(selected.toUpperCase()).slice(0, 2).join("");
}
