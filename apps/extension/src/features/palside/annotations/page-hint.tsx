'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { errorMessage, message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { identifyPage, websiteIdentity } from '@palside/shared/navigation';
import { personFor } from '../../../domain/account/model';
import type { Viewing } from '../../../domain/assets/model';
import { samePage, viewAsset } from '../../../domain/annotations/social';
import { pageView } from '../../../runtime/viewing/view-snapshot';
import { tokenPage } from '../../../runtime/viewing/page-resolver';
import { signalAsset, type SignalKind, type SignalRecord } from '../../../runtime/annotations/signals';
import { DRAWING_RUN, emoteRun, runEmote, type SignalRunCount } from '../../../domain/annotations/signal-runs';
import type { WheelEntry } from '../../../runtime/annotations/signals';
import { createdAt } from '../../../runtime/annotations/chart-drawings';
import { WheelArt } from '../settings/signal-settings';
import { Count } from '../ui/motion-details';
import { PersonAvatar, Token } from '../ui/primitives';
import { tokenLabel } from '../assets/token-name';
import { openPage } from './reminders';
import { captureSocialUi } from './social-state';
import { locateFeedback } from './locate-feedback';
import { withTargetAccess } from '../settings/access';
import { liveView } from '../assets/token-data';
import type { PalsideController } from '../app/use-palside';
import s from './page-hint.module.css';

/** A line in the chat about a page: a signal the chat keeps, a 共享画线 drawing, or 喊你来看. */
export type PageHint = { id: string; timestamp: number; hint: { kind: 'signal' | 'drawing' | 'poke'; noteId: string; personId: string; view?: Viewing; count?: number; signal?: SignalKind; emote?: string; url?: string; at?: number; pending?: boolean } };

/** The page a signal or drawing was made on, drawn like any shared page: a token page as its token, another page as its site. */
function recordView(record: Pick<SignalRecord, 'url' | 'asset'>) {
  const identity = identifyPage(record.url), asset = signalAsset(record);
  const source = identity?.kind === 'asset' ? identity
    : asset && (identity?.kind === 'pool' || identity?.kind === 'address') ? tokenPage(identity, asset)
    : websiteIdentity(record.url, 'page');
  return source ? pageView(source) : undefined;
}

/** Signals stay in the chat as long as the squad's messages, at the time they were made, wherever you are.
 *  喊你来看 is a request for now: it goes when opened, ignored, reached or expired. */
export function usePageHints(c: PalsideController): PageHint[] {
  const page = c.live.page, command = c.live.command, state = c.live.state, team = c.current;
  // The tab in front answers a call even while sharing is off, so the panel checks it too; the runtime drops calls to a page it shares.
  const here = (view: Viewing) => Boolean(page?.url && (samePage(page.url, view.url, page.asset) || view.kind === 'asset' && page.asset && viewAsset(view) === page.asset));
  // One row per caller and page: calling again moves it to the newest place and raises its count.
  const pokes = (state?.pokes ?? []).filter(poke => poke.teamId === team).map(poke => ({ id: `poke-${poke.from}-${poke.view.url}`, timestamp: poke.at, hint: { kind: 'poke' as const, noteId: poke.id, personId: poke.from, view: poke.view, count: poke.count } }));
  const reached = pokes.filter(item => here(item.hint.view));
  const seen = reached.map(item => item.hint.noteId).join();
  useEffect(() => {
    if (!seen || !command) return;
    for (const id of seen.split(',')) void command('dismiss-poke', { id }).catch(() => {});
  }, [seen, command]);
  const records = state?.signalRecords;
  const signals = useMemo(() => (records ?? []).filter(record => record.teamId === team).map(record => ({ id: `signal-${record.id}`, timestamp: record.timestamp, hint: { kind: 'signal' as const, noteId: record.id, personId: record.personId, view: recordView(record), signal: record.kind, ...(record.emote ? { emote: record.emote } : {}), url: record.url, at: record.timestamp, ...(record.pending ? { pending: true } : {}) } })), [records, team]);
  // A drawing's line sits where it was first drawn; edits change nothing in the chat, a deletion takes it out.
  const drawings = state?.chartDrawings, pages = state?.pages;
  const drawn = useMemo(() => (drawings ?? []).filter(record => record.teamId === team && record.shape).map(record => {
    const identity = identifyPage(record.url), at = createdAt(record);
    const asset = record.asset ?? (identity?.kind === 'pool' || identity?.kind === 'address' ? pages?.[identity.url] ?? undefined : undefined);
    return { id: `drawing-${record.personId}-${record.id}`, timestamp: at, hint: { kind: 'drawing' as const, noteId: record.id, personId: record.personId, view: recordView({ url: record.url, asset }), url: record.url, at } };
  }), [drawings, pages, team]);
  return [...signals, ...drawn, ...pokes.filter(item => !reached.includes(item))];
}

/** The 共享画线 mark as it sits in the chart toolbar while 共享给小队 is on: a trend line drawn in the logo's bubble. */
function DrawingArt() {
  return <svg className={s.art} viewBox="0 0 128 128" width="18" height="18" aria-hidden="true">
    <rect x="4" y="4" width="120" height="120" rx="32" fill="var(--ui-accent)" />
    <path d="M38 33H90A4 4 0 0 1 94 37V75A4 4 0 0 1 90 79H59.333Q58 79 56.933 79.8L36.4 95.2Q34 97 34 94V37A4 4 0 0 1 38 33Z" fill="var(--ui-on-accent)" />
    <path d="M46 69L58 58L67 63L83 45" fill="none" stroke="var(--ui-accent)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** How long after it was made a line still arrives with motion; an older one is simply there when the chat opens. */
const ARRIVING_MS = 5_000;

/**
 * A small centred hint in the timeline, not a message: what happened, who, which page. A signal's line opens the page and plays the
 * signal again; a drawing's line opens the page and brings the chart to the newest drawing in it; 喊你来看 opens the page and × ignores it.
 */
export function PageHintRow({ c, item, counts }: { c: PalsideController; item: PageHint['hint']; counts?: SignalRunCount[] }) {
  const t = useTranslations(), reduced = useReducedMotion();
  const [busy, setBusy] = useState(false);
  // Rows restored from history appear without the arrival motion.
  const [arriving] = useState(() => item.at === undefined || Date.now() - item.at < ARRIVING_MS);
  const person = personFor(c.people, item.personId, t('common.member'));
  const view = item.view && liveView(c, item.view);
  const dismiss = () => { if (item.kind === 'poke') void c.live.command('dismiss-poke', { id: item.noteId }).catch(() => {}); };
  // The newest in the line: a signal plays again, a drawing brings the chart to it.
  const replay = () => {
    const session = captureSocialUi();
    withTargetAccess(c, item.url!, () => {
      if (!session.current() || !c.ownsScreen()) return;
      setBusy(true);
      const request = item.kind === 'drawing' ? c.live.command('drawing-show', { teamId: c.current, personId: item.personId, recordId: item.noteId })
        : c.live.command('signal-replay', { teamId: c.current, recordId: item.noteId });
      void request
        .then(({ result }) => { const key = locateFeedback[result]; if (session.current() && key) c.setNotice(uiMessage(key)); }, error => { if (session.current()) c.setNotice(errorMessage(error)); })
        .finally(() => setBusy(false));
    });
  };
  const place = view ? tokenLabel(view, t, c) : '';
  const page = (chunks: ReactNode) => <span className={s.place}>{view && <Token view={view} size="sm" />}<b>{chunks}</b></span>;
  // Your own signal reads 你在, without the space a name gets before 在.
  const kindName = (kind: string) => { const emote = runEmote(kind); return kind === DRAWING_RUN ? t('extension.top.drawing') : emote ? t(`extension.signal.emote_${emote}`) : t(`extension.signal.${kind}`); };
  const times = (count: number) => count > 1 && <span className={s.times}>×<Count value={count} /></span>;
  // Emotes first, then signals, then drawing: 发了冲 ×3 · 标了警惕 · 画线 ×3.
  const rank = (kind: string) => runEmote(kind) ? 0 : kind === DRAWING_RUN ? 2 : 1;
  const list = (counts?.length ? counts : [{ kind: item.kind === 'drawing' ? DRAWING_RUN : item.emote ? emoteRun(item.emote) : item.signal ?? 'attention', count: 1 }])
    .toSorted((a, b) => rank(a.kind) - rank(b.kind));
  const emotes = list.filter(entry => runEmote(entry.kind)), marks = list.filter(entry => !runEmote(entry.kind));
  const drawingsOnly = list.every(entry => entry.kind === DRAWING_RUN), self = item.personId === c.data.self;
  const names = (entries: SignalRunCount[]) => entries.map((entry, index) => <span key={entry.kind}>{index > 0 && ' · '}{kindName(entry.kind)}{times(entry.count)}</span>);
  // Both in one row: each group says its own verb, 发了冲 · 标了赞同; a group of drawings alone needs none.
  const acted = () => [
    <span key="emotes">{t('extension.top.verbEmote')}{names(emotes)}</span>,
    <span key="marks">{' · '}{marks.some(entry => entry.kind !== DRAWING_RUN) && t('extension.top.verbSignal')}{names(marks)}</span>,
  ];
  const text = item.kind === 'poke' ? t.rich('extension.top.pokeAt', { name: person.name, place, page, times: () => times(item.count ?? 1) })
    : drawingsOnly ? self ? t.rich('extension.top.drewAtSelf', { place, page, times: () => times(list[0]!.count) }) : t.rich('extension.top.drewAt', { name: person.name, place, page, times: () => times(list[0]!.count) })
    : !marks.length ? self ? t.rich('extension.top.emoteAtSelf', { kind: () => names(emotes), place, page }) : t.rich('extension.top.emoteAt', { name: person.name, kind: () => names(emotes), place, page })
    : emotes.length ? self ? t.rich('extension.top.actedAtSelf', { kind: acted, place, page }) : t.rich('extension.top.actedAt', { name: person.name, kind: acted, place, page })
    : self ? t.rich('extension.top.signalAtSelf', { kind: () => names(marks), place, page }) : t.rich('extension.top.signalAt', { name: person.name, kind: () => names(marks), place, page });
  // The row's picture is its first entry: an emote's own image, a signal's mark, or the drawing mark.
  const first = list[0]?.kind, firstEmote = first && runEmote(first);
  // 喊你来看 leads with the caller's face (no presence dot: the line is about the call); signals and drawings lead with their mark.
  const art = item.kind === 'poke' ? <PersonAvatar person={{ ...person, presence: undefined }} size="xs" />
    : drawingsOnly ? <DrawingArt />
    : <WheelArt entry={(firstEmote ?? (first !== DRAWING_RUN ? first : undefined) ?? item.signal ?? 'attention') as WheelEntry} style={firstEmote ? { width: 20, height: 20, flex: 'none', objectFit: 'contain' } : { width: 18, height: 18, flex: 'none' }} />;
  return <motion.div className={s.row} layout={!reduced && item.kind === 'poke'}
    initial={!arriving ? false : reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={reduced ? { opacity: 0 } : { opacity: 0, scale: .96, transition: { duration: .18 } }} transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
    <span className={s.note} data-pending={item.pending || undefined}>
      <button type="button" className={s.open} disabled={!view || item.pending} aria-busy={busy || item.pending} onClick={() => { if (item.kind === 'poke') { if (view) openPage(c, view, dismiss); } else replay(); }}
        aria-label={`${t('extension.top.open')} · ${place}`}>
        {art}<span className={s.text}>{text}</span>
      </button>
      {item.kind === 'poke' && <button type="button" className={s.ignore} onClick={dismiss} aria-label={t('extension.top.ignore')} title={t('extension.top.ignore')}><X size={12} strokeWidth={2.2} /></button>}
    </span>
  </motion.div>;
}
