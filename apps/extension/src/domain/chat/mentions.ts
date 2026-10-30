import type { Draft } from './model';
import type { Person } from '../account/model';

export function mentionQuery(text: string, caret: number) {
  const match = /(?:^|[\s，。！？(（\p{Script=Han}])@([^@\s]{0,24})$/u.exec(text.slice(0, caret));
  return match ? { start: caret - match[1]!.length - 1, end: caret, query: match[1]! } : undefined;
}
export function insertMention(draft: Draft, person: Person, start: number, end: number) {
  const token = `@${person.name} `;
  return { text: draft.text.slice(0, start) + token + draft.text.slice(end), mentions: [...(draft.mentions ?? []).filter(p => p.id !== person.id), { id: person.id, label: person.name }], caret: start + token.length };
}
export function messageParts(text: string, people: Person[], ids: string[] = []) {
  const candidates = people.filter(p => ids.includes(p.id)).sort((a, b) => b.name.length - a.name.length);
  const parts: { text: string; personId?: string; url?: boolean }[] = [];
  let plain = '';
  const flush = () => { if (plain) { parts.push({ text: plain }); plain = ''; } };
  for (let i = 0; i < text.length;) {
    const url = /^https?:\/\/[^\s]+/.exec(text.slice(i));
    if (url) { flush(); parts.push({ text: url[0], url: true }); i += url[0].length; continue; }
    const boundary = i === 0 || /[\s，。！？(（\p{Script=Han}]/u.test(text[i - 1]!);
    const person = boundary && candidates.find(p => text.startsWith(`@${p.name}`, i) && !/[\p{L}\p{N}_]/u.test(text[i + p.name.length + 1] ?? ''));
    if (person) { flush(); parts.push({ text: `@${person.name}`, personId: person.id }); i += person.name.length + 1; }
    else { plain += text[i++]; }
  }
  flush(); return parts;
}
