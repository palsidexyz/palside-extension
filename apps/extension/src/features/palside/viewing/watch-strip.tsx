'use client';
import { Spinner } from '@palside/ui/spinner';
import { message as uiMessage,failureText } from '@palside/i18n';

import { useTranslations } from 'use-intl';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { ArrowUpRight, ChevronDown, Copy } from 'lucide-react';
import { motionPresets } from '@palside/design/motion';
import { Tooltip } from '@palside/ui/tooltip';
import { AddressCopy } from '@palside/ui/address-copy';
import { Popover, PopoverTrigger, PopoverContent, usePopoverContext } from '@palside/ui/popover';
import { shortAddress } from '@palside/shared/navigation';
import { PersonAvatar, Token } from '../ui/primitives';
import { captureSocialUi, useSocialUi } from '../annotations/social-state';
import type { TopCard } from '../annotations/reminders';
import type { Person } from '../../../domain/account/model';
import type { Viewing } from '../../../domain/assets/model';
import { ChainLogo } from '../assets/chain-identity';
import { SiteLogo } from '../assets/site-logo';
import { siteAt } from '../settings/site-catalog';
import { Count, CountText } from '../ui/motion-details';
import { openRoom, roomKeyFor, roomsOn } from '../rooms/rooms';
import { overtake, placeSlots, rankedKeys, sourceLabel, stickyFaces, watchGroups, type WatchGroup, type WatchSlot, type WatchSource } from './watch-groups';
import type { PalsideController } from '../app/use-palside';
import s from './watch-strip.module.css';
import { NamePending,TokenName,tokenLabel,tokenWaiting } from '../assets/token-name';
import { liveView } from '../assets/token-data';
import { displayHost } from '../../../domain/assets/site-host';

/** How long a shared page may stay without its title or icon before its domain and first letter stand in. */
const PAGE_WAIT_MS = 6000;

/** What a shared page is still waiting for: both arrive just after the address, and the sender republishes them in place. */
function usePageWaiting(view: Viewing) {
  const website = view.kind === 'website';
  const untitled = website && view.disclosure === 'page' && displayHost(view.url) === view.name.replace(/^www\./, '');
  const missing = untitled || website && !view.logo;
  const [gaveUp, setGaveUp] = useState<string>();
  useEffect(() => {
    if (!missing) return;
    const timer = setTimeout(() => setGaveUp(view.url), PAGE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [missing, view.url]);
  const waiting = gaveUp !== view.url;
  return { title: untitled && waiting, face: website && !view.logo && waiting };
}

function linkHint(input: string, home: string) {
  const url = new URL(input);
  return `${url.host}\n${url.pathname === '/' && !url.search && !url.hash ? home : `${url.pathname}${url.search}${url.hash}`}`;
}

type WatchChipProps = { group: WatchGroup; c: PalsideController; onMenu: (open: boolean) => void; onOpenPage?: (url: string) => void; merges: string[]; pop: string[]; listed?: boolean; followed?: string };

function WatchChip(props: WatchChipProps) {
  return <Popover boundarySelector="[data-palside-app]" align="start"><WatchChipContent {...props} /></Popover>;
}

function WatchChipContent({ group, c, onMenu, onOpenPage, merges, pop, listed, followed }: WatchChipProps) {
  const t = useTranslations();
  const followPaused = Boolean(useSocialUi().follow?.paused);
  const present = useIsPresent(); const reduced = useReducedMotion();
  const { anchorRef, layerRef, close } = usePopoverContext();
  const [menu, setMenu] = useState<WatchSource[] | null>(null);
  const [opening, setOpening] = useState<string>();
  const openingRequest = useRef(false);
  const pressed = useRef<string | undefined>(undefined);
  const menuOpen = useRef(false); const owner = useRef<Element | null>(null);
  const signature = group.sources.map(source => source.key).sort().join('|');
  const multiple = group.sources.length > 1;
  const single = group.sources[0];
  // Under the name: a token's source site, a website's own domain — so the two read apart before they are opened.
  // A site outside the catalog is named by its domain: one line, never the domain twice.
  const pageWaiting = usePageWaiting(group.view);
  const sameName = !pageWaiting.title && !multiple && group.view.kind === 'website' && Boolean(single) && displayHost(single!.url) === group.view.name.replace(/^www\./, '');
  const caption = sameName ? undefined : multiple ? <CountText text={t('extension.dynamic.sourceCount', { count: group.sources.length })} value={group.sources.length} /> : group.view.kind === 'asset' ? single?.view.source : single && displayHost(single.url);
  useEffect(() => { if (!present) { const focused = menuOpen.current || layerRef.current?.contains(document.activeElement) || anchorRef.current === document.activeElement; close(false); onMenu(false); if (focused) anchorRef.current?.closest('[data-palside-app]')?.querySelector<HTMLTextAreaElement>('[data-message-input]')?.focus({ preventScroll: true }); } }, [present, close, onMenu, layerRef, anchorRef]);
  useEffect(() => () => { if (menuOpen.current) owner.current?.querySelector<HTMLTextAreaElement>('[data-message-input]')?.focus({ preventScroll: true }); onMenu(false); }, [onMenu]);
  // The place took another page: the old page's source menu closes with it.
  const shownKey = useRef(group.key);
  useEffect(() => { if (shownKey.current === group.key) return; shownKey.current = group.key; close(false); setMenu(null); }, [group.key, close]);
  async function open(url: string) {
    if (openingRequest.current || !present) return;
    const session = captureSocialUi();
    openingRequest.current = true; setOpening(url);
    try {
      if (onOpenPage) await onOpenPage(url);
      else await c.live.openPage(url);
      if (session.current()) close();
    } catch (error) { if (session.current()) c.setNotice(failureText(error, 'extension.copy.openPageFailed')); }
    finally { openingRequest.current = false; setOpening(undefined); }
  }
  function activate() {
    if (openingRequest.current) return;
    if (menu) { close(); return; }
    if (!present || pressed.current !== undefined && pressed.current !== signature) { pressed.current = undefined; return; }
    pressed.current = undefined;
    if (!multiple) { if (single) void open(single.url); return; }
    setMenu(rankedKeys(group.sources).map(key => group.sources.find(source => source.key === key)!));
    layerRef.current?.showPopover();
  }
  // A token chip has two targets: its name opens the token's 弹幕, the source line under it opens the page.
  const room = roomsOn(c) && group.view.kind === 'asset' ? roomKeyFor(group.view) : undefined;
  const viewName = tokenLabel(group.view, t, c);
  const roomLabel = t('extension.room.tab', { name: viewName });
  const sourceHint = multiple ? t('extension.copy.selectSource') : t('extension.dynamic.openSource', { name: (single?.view.source ?? t('extension.copy.sourcePage')) ?? '' });
  const press = { onPointerDown: () => { pressed.current = signature; }, onPointerCancel: () => { pressed.current = undefined; }, onKeyDown: () => { pressed.current = signature; } };
  const captionLine = <>{caption}{opening ? <Spinner size={12} className={s.loadingIcon} /> : multiple || menu ? <ChevronDown size={12} /> : <ArrowUpRight size={12} />}</>;
  const rows = menu ? [...menu.map(old => group.sources.find(source => source.key === old.key) ?? { ...old, members: [] }), ...group.sources.filter(source => !menu.some(old => old.key === source.key))] : [];
  const enter = reduced ? motionPresets.reduced : motionPresets.feedback;
  return <motion.div initial={listed ? false : { opacity: 0, flexGrow: 0, marginRight: -6 }} animate={{ opacity: 1, flexGrow: 1, marginRight: 0 }} exit={{ opacity: 0, flexGrow: 0, marginRight: -6 }} transition={enter} className={s.chip} data-together={group.members.some(member => member.id === c.data.self) || undefined} data-follow={followed && group.members.some(member => member.id === followed) || undefined} data-follow-paused={followPaused && followed && group.members.some(member => member.id === followed) || undefined} aria-hidden={!present || undefined} data-watch-key={group.key}>
    <div className={s.wrap}><AnimatePresence initial={false}><ChipLayer key={group.key}>{live => <>
    {room ? <div className={s.target} data-split>
      <Token view={group.view} size="sm" waiting={tokenWaiting(c, group.view)} />
      <span className={s.text}>
        <Tooltip content={roomLabel}><button type="button" className={s.roomName} disabled={!present || !live} aria-label={roomLabel} onClick={() => { if (present) openRoom(c, room); }}><strong><TokenName c={c} view={group.view} /></strong></button></Tooltip>
        <Tooltip content={sourceHint}><AnchorButton type="button" className={s.sourceLine} disabled={!present || !live} aria-busy={Boolean(opening) || undefined} aria-disabled={Boolean(opening) || undefined} aria-label={opening ? t('extension.dynamic.openingPage', { name: viewName }) : multiple ? t('extension.copy.selectSource') : t('extension.room.openOn', { name: single?.view.source ?? t('extension.copy.sourcePage') })} aria-haspopup={multiple || menu ? 'dialog' : undefined} aria-expanded={multiple || menu ? Boolean(menu) : undefined} {...press} onClick={activate}>{captionLine}</AnchorButton></Tooltip>
      </span>
    </div> : <Tooltip content={group.view.kind === 'asset' ? `${group.view.chain} · ${viewName}\n${group.view.address ? shortAddress(group.view.address) : ''}\n${sourceHint}` : multiple ? t('extension.copy.selectPage') : single ? `${sameName || pageWaiting.title ? '' : `${viewName}\n`}${linkHint(single.url, t('extension.copy.websiteHome'))}` : group.view.name}>
      <AnchorButton className={s.target} type="button" disabled={!present || !live} aria-busy={Boolean(opening) || undefined} aria-disabled={Boolean(opening) || undefined} aria-label={opening ? t('extension.dynamic.openingPage', { name: viewName }) : t('extension.dynamic.openSource', { name: viewName })} aria-haspopup={multiple || menu ? 'dialog' : undefined} aria-expanded={multiple || menu ? Boolean(menu) : undefined} {...press} onClick={activate}>
        <Token view={group.view} size="sm" waiting={pageWaiting.face ? 'name' : tokenWaiting(c, group.view)} />{sameName
          ? <span className={s.text} data-one><strong><TokenName c={c} view={group.view} /></strong>{captionLine}</span>
          : <span className={s.text}><strong>{pageWaiting.title ? <NamePending /> : <TokenName c={c} view={group.view} />}</strong><small>{captionLine}</small></span>}
      </AnchorButton>
    </Tooltip>}
    </>}</ChipLayer></AnimatePresence></div>
    <Tooltip content={t('extension.copy.viewWatchers')}><button className={s.count} disabled={!present || Boolean(onOpenPage)} aria-label={t('extension.dynamic.viewingPeople', { name: viewName, count: (group.members.length) ?? '' })} onClick={() => { c.setMemberFilter(group.key); c.go('members'); }}><AvatarStack c={c} members={group.members} page={group.key} pop={pop} followed={followed} /></button></Tooltip>
    {merges.map(merge => <MergeEffect key={merge} />)}
    <PopoverContent aria-label={t('extension.dynamic.sourcesFor', { name: viewName })} className={s.menu}
      onToggle={event => { if (event.target !== event.currentTarget) return; const shown = event.newState === 'open'; menuOpen.current = shown; if (shown) owner.current = anchorRef.current?.closest('[data-palside-app]') ?? null; onMenu(shown); if (!shown) setMenu(null); else layerRef.current?.focus({ preventScroll: true }); }}>
      {group.view.kind === 'asset' && group.view.address && <div className={s.contractRow}><AddressCopy className={s.contract} address={group.view.address} display={shortAddress(group.view.address)} label={t('extension.copy.copyContract')} ariaLabel={t('extension.dynamic.copyChainContract', { chain: (group.view.chain) ?? '', address: group.view.address })} icon={group.view.chain && <ChainLogo chain={group.view.chain} />} onCopy={copied => { if (!copied) c.setNotice(uiMessage('extension.copy.copyFailed')); }} /></div>}
      {rows.map(source => { const active = present && source.members.length > 0; const target = <button className={s.sourceTarget} disabled={!active} aria-busy={opening === source.url || undefined} aria-disabled={Boolean(opening) || undefined} onClick={() => { const current = group.sources.find(item => item.key === source.key); if (present && current?.members.length) { void open(current.url); } }}>
          <SiteLogo site={siteAt(c, source.url, source.view.kind === 'website' ? source.view.logo : undefined)} size="xs" /><span className={s.sourceText}>{sourceLabel(source, t)}{group.view.kind === 'asset' && group.sources.filter(item => item.view.source === source.view.source).length > 1 && <small>{new URL(source.url).pathname.split('/').at(-1)?.slice(0,8)}…</small>}</span><small>{active ? <CountText text={t('extension.dynamic.peopleCount', { count: source.members.length })} value={source.members.length} /> : t('extension.copy.leftTeam')}</small>{opening === source.url ? <Spinner size={13} className={s.loadingIcon} /> : <ArrowUpRight size={13} />}
        </button>; return <div key={source.key} className={s.source}>
        {source.view.kind === 'asset' ? target : <Tooltip content={active ? linkHint(source.url, t('extension.copy.websiteHome')) : t('extension.copy.leftTeam')}>{target}</Tooltip>}
        <Tooltip content={t('extension.copy.copyLink')}><button className={s.copy} disabled={!active} aria-label={t('extension.dynamic.copySourceLink', { name: (sourceLabel(source, t)) ?? '' })} onClick={() => { if (present && group.sources.some(item => item.key === source.key)) void navigator.clipboard.writeText(source.url).catch(() => c.setNotice(uiMessage('extension.copy.copyFailed'))); }}><Copy size={13} /></button></Tooltip>
      </div>; })}
    </PopoverContent>
  </motion.div>;
}

/** Whether the chip layer around a control is the current page's, not one rolling out. */
const LayerLive = createContext(true);

/** One page's content in a chip. A new page rolls up into the place while the old one rolls out above it; only the
 *  current layer takes input. */
function ChipLayer({ children }: { children: (live: boolean) => ReactNode }) {
  const live = useIsPresent(); const reduced = useReducedMotion();
  return <LayerLive.Provider value={live}><motion.div className={s.layer} data-leaving={!live || undefined} inert={!live} aria-hidden={!live || undefined}
    initial={reduced ? { opacity: 0 } : { opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -22 }}
    transition={reduced ? motionPresets.reduced : { duration: .3, ease: motionPresets.feedback.ease }}>
    {children(live)}
  </motion.div></LayerLive.Provider>;
}

/** The chip's popover anchor. While the old page rolls out its button lets go, so the source menu always opens from the
 *  current page. */
function AnchorButton({ ref: outer, ...props }: ComponentProps<'button'>) {
  const live = useContext(LayerLive); const { anchorRef } = usePopoverContext();
  const own = useRef<HTMLButtonElement | null>(null);
  const ref = useCallback((node: HTMLButtonElement | null) => {
    if (typeof outer === 'function') outer(node); else if (outer) outer.current = node;
    if (node) { own.current = node; if (live) anchorRef.current = node; }
    else if (anchorRef.current === own.current) anchorRef.current = null;
  }, [live, anchorRef, outer]);
  return <button {...props} ref={ref} />;
}

/** Up to two faces — the user first when they are here too — then a +N disc for everyone else. Faces keep their places:
 *  one changes only when that person leaves (the next person fades in where they were) or the user arrives; everyone else
 *  coming and going only rolls the +N. A new page in the chip brings its own faces. */
function AvatarStack({ c, members, page, pop, followed }: { c: PalsideController; members: Person[]; page: string; pop: string[]; followed?: string }) {
  const reduced = useReducedMotion();
  const ids = members.map(member => member.id); const signature = `${page}|${ids.join(',')}|${followed ?? ''}`;
  const [kept, setKept] = useState(() => ({ signature, page, faces: stickyFaces([], ids, c.data.self, 2, followed) }));
  let faces = kept.faces;
  if (kept.signature !== signature) { faces = stickyFaces(kept.page === page ? kept.faces : [], ids, c.data.self, 2, followed); setKept({ signature, page, faces }); }
  const shown = faces.map(id => members.find(member => member.id === id)).filter((member): member is Person => Boolean(member));
  const rest = members.length - shown.length;
  const fade = reduced ? motionPresets.reduced : { duration: .22, ease: motionPresets.feedback.ease };
  // A second face or the +N opens from under the one before it, so the chip's edge moves instead of jumping.
  const seat = (lead: boolean) => reduced || lead ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : { initial: { opacity: 0, marginLeft: -20 }, animate: { opacity: 1, marginLeft: -10 }, exit: { opacity: 0, marginLeft: -20 } };
  return <span className={s.stack} aria-hidden="true">
    <AnimatePresence initial={false}>
      {shown.map((face, i) => <motion.span key={i} className={s.face} {...seat(i === 0)} transition={fade}>
        <AnimatePresence initial={false}><motion.span key={face.id} className={s.faceLayer} data-self={face.id === c.data.self || undefined} data-followed={face.id === followed || undefined}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduced ? fade : { ...fade, delay: pop.includes(face.id) ? .12 : 0 }}>
          <PersonAvatar person={face} size="xs" />
        </motion.span></AnimatePresence>
      </motion.span>)}
      {rest > 0 && <motion.span key="rest" className={s.rest} {...seat(false)} transition={fade}>+<Count value={rest} /></motion.span>}
    </AnimatePresence>
  </span>;
}

function MergeEffect() {
  return <motion.span className={s.merge} aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 1.7, times: [0, 0.12, 0.6, 1] }} />;
}

/** Merge lifetimes belong to the strip, including chips hidden by the top card or removed groups. */
function useMergeExpiry(merges: { id: string }[], onDone: (id: string) => void, lifetime = 1_800) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const active = new Set(merges.map(merge => merge.id));
    for (const [id, timer] of timers.current) if (!active.has(id)) { clearTimeout(timer); timers.current.delete(id); }
    for (const { id } of merges) if (!timers.current.has(id)) timers.current.set(id, setTimeout(() => { onDone(id); }, lifetime));
  }, [merges, onDone, lifetime]);
  useEffect(() => {
    const current = timers.current;
    return () => { for (const timer of current.values()) clearTimeout(timer); current.clear(); };
  }, []);
}

/** Someone joining the user's chip tints it at most once in this window, so a busy page does not keep flashing. */
const MERGE_GAP = 3_000;
/** A hidden page must stay this far ahead of a shown one for this long before it takes that place. */
const OVERTAKE_AFTER = 1_500;

/** The top slot under the team header: one 44px row. Usually the 在看 chips in two fixed half-row places — one chip alone keeps its half, so a
 *  second page fills the other half without moving it — the rest under a +N square; only a connection or read-only card takes the row instead,
 *  and what it covers moves under +N. 跟看 marks the followed teammate's chip and keeps it in a shown place. Same height either way. A place keeps its page while anyone is on it; when its page empties the
 *  next page rolls into the same place, so one person switching pages changes one chip in place. */
export function WatchStrip({ c, onOpenPage, top }: { c: PalsideController; onOpenPage?: (url: string) => void; top?: TopCard }) {
  const t = useTranslations();
  const people = c.people.filter(person => c.team.memberIds.includes(person.id));
  const groups = c.disconnected || c.team.readonly ? [] : watchGroups(people, c.data.views.map(view => liveView(c, view)));
  const filled = Boolean(top) || groups.length > 0;
  const [holdSpace, setHoldSpace] = useState(filled);
  if (filled && !holdSpace) setHoldSpace(true);
  useEffect(() => { if (filled) return; const timeout = setTimeout(() => setHoldSpace(false), 1200); return () => clearTimeout(timeout); }, [filled]);
  const retainingSpace = !filled && holdSpace && c.share;
  const [order, setOrder] = useState(() => rankedKeys(groups));
  const [hover, setHover] = useState(false); const [focus, setFocus] = useState(false); const [menu, setMenu] = useState(false);
  const latest = useRef(groups); const blocked = useRef(false); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reduced = useReducedMotion();
  const signature = JSON.stringify(groups.map(group => [group.key, group.members.length]));
  useEffect(() => { latest.current = groups; });
  // The order settles only while the row is left alone, so a chip never moves under the pointer.
  useEffect(() => {
    blocked.current = hover || focus || menu;
    if (blocked.current || timer.current) return;
    timer.current = setTimeout(() => { timer.current = undefined; if (!blocked.current) setOrder(previous => rankedKeys(latest.current, previous)); }, 500);
  }, [signature, hover, focus, menu]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Merge moments come from the previous render's groups: someone joins the user's chip, or the user joins someone's.
  // While disconnected or read-only the row is empty, not deserted: coming back compares with who was there before.
  const offline = c.disconnected || c.team.readonly;
  const memberSignature = groups.map(group => `${group.key}:${group.members.map(member => member.id).sort().join(',')}`).join('|');
  const [seen, setSeen] = useState<{ signature: string; members: Map<string, Set<string>>; n: number }>();
  const [merges, setMerges] = useState<{ id: string; key: string; joiners: string[] }[]>([]);
  const [cooling, setCooling] = useState<{ id: string }[]>([]);
  if (!offline && seen?.signature !== memberSignature) {
    const found: { id: string; key: string; joiners: string[] }[] = [];
    let n = seen?.n ?? 0;
    for (const group of seen ? groups : []) {
      const before = seen!.members.get(group.key) ?? new Set<string>();
      const members = group.members.map(member => member.id);
      const joiners = members.filter(member => !before.has(member));
      if (joiners.length && members.includes(c.data.self) && members.length >= 2 && !cooling.some(cool => cool.id === group.key)) found.push({ id: `${group.key}-${++n}`, key: group.key, joiners: joiners.includes(c.data.self) ? members.filter(member => member !== c.data.self) : joiners });
    }
    setSeen({ signature: memberSignature, members: new Map(groups.map(group => [group.key, new Set(group.members.map(member => member.id))])), n });
    if (found.length) { setMerges(old => [...old, ...found]); setCooling(old => [...old, ...found.map(merge => ({ id: merge.key }))]); }
  }
  const merged = useCallback((id: string) => setMerges(old => old.filter(merge => merge.id !== id)), []);
  useMergeExpiry(merges, merged);
  const cooled = useCallback((id: string) => setCooling(old => old.filter(cool => cool.id !== id)), []);
  useMergeExpiry(cooling, cooled, MERGE_GAP);
  const keys = [...order.filter(key => groups.some(group => group.key === key)), ...rankedKeys(groups.filter(group => !order.includes(group.key)))];
  // Two places that keep their pages; see placeSlots.
  const [places, setPlaces] = useState<{ seq: number; slots: WatchSlot[] }>(() => { let seq = 0; return { slots: placeSlots([], keys, () => ++seq), seq }; });
  let seq = places.seq; const slots = places.slots;
  const follow = useSocialUi().follow;
  const followed = follow && follow.teamId === c.current ? follow.personId : undefined;
  const followKey = followed ? groups.find(group => group.members.some(member => member.id === followed))?.key : undefined;
  const filledSlots = placeSlots(slots, keys, () => ++seq);
  // The followed teammate's page is never left under +N: it rolls into the quieter place, like an overtake.
  const quieter = filledSlots.length ? filledSlots.reduce((a, b) => (groups.find(group => group.key === b.key)?.members.length ?? 0) < (groups.find(group => group.key === a.key)?.members.length ?? 0) ? b : a) : undefined;
  const placed = followKey && quieter && !filledSlots.some(slot => slot.key === followKey) ? filledSlots.map(slot => slot.id === quieter.id ? { ...slot, key: followKey } : slot) : filledSlots;
  if (placed.length !== slots.length || placed.some((slot, i) => slot.id !== slots[i]!.id || slot.key !== slots[i]!.key)) setPlaces({ seq, slots: placed });
  // A clearly busier hidden page takes the quieter place only after staying ahead, and never under the pointer.
  // The followed page's place is not up for an overtake.
  const contest = (current: WatchSlot[], items: WatchGroup[], order: string[], kept?: string) => overtake(current.filter(slot => slot.key !== kept), items, order.filter(key => key !== kept));
  const lead = top ? undefined : contest(placed, groups, keys, followKey);
  const leadSignature = lead ? `${lead.id}>${lead.key}` : '';
  const latestKeys = useRef(keys); const latestFollow = useRef(followKey);
  useEffect(() => { latestKeys.current = keys; latestFollow.current = followKey; });
  const held = hover || focus || menu;
  useEffect(() => {
    if (!leadSignature || held) return;
    const timeout = setTimeout(() => setPlaces(current => {
      const now = contest(current.slots, latest.current, latestKeys.current, latestFollow.current);
      return now && `${now.id}>${now.key}` === leadSignature ? { ...current, slots: current.slots.map(slot => slot.id === now.id ? now : slot) } : current;
    }), OVERTAKE_AFTER);
    return () => clearTimeout(timeout);
  }, [leadSignature, held]);
  const chip = (key: string, id: string | number = key, listed = false) => <WatchChip key={id} listed={listed} followed={followed} group={groups.find(group => group.key === key)!} c={c} onMenu={setMenu} onOpenPage={onOpenPage} merges={merges.filter(merge => merge.key === key).map(merge => merge.id)} pop={merges.filter(merge => merge.key === key).flatMap(merge => merge.joiners)} />;
  const shown = top ? [] : placed;
  const hidden = top ? keys : keys.filter(key => !placed.some(slot => slot.key === key));
  const more = hidden.length;
  // The +N list is one chip wide: its rows match the chips in the row above it. Measured as +N is pressed, before the list is placed.
  const stripRef = useRef<HTMLDivElement>(null);
  function fitColumn() {
    const strip = stripRef.current; if (!strip) return;
    const style = getComputedStyle(strip), gap = parseFloat(style.columnGap) || 0;
    const square = strip.querySelector<HTMLElement>(`.${s.more}`)?.getBoundingClientRect().width ?? 0;
    strip.style.setProperty('--watch-column', `${(strip.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - square - 2 * gap) / 2}px`);
  }
  return <motion.div className={s.region} initial={false} animate={{ height: retainingSpace || filled ? 52 : 0, opacity: filled ? 1 : 0 }} transition={reduced ? motionPresets.reduced : motionPresets.feedback} inert={!filled} aria-hidden={!filled || undefined}>
  <div ref={stripRef} data-watch-strip className={s.strip} aria-label={t('extension.copy.teamViewing')} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onFocusCapture={() => setFocus(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocus(false); }} data-reduced-motion={Boolean(reduced)}>
    {top ? <motion.div key={top.key} className={s.card} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={reduced ? motionPresets.reduced : motionPresets.feedback}>{top.card}</motion.div>
      : <AnimatePresence initial={false}>{shown.map(slot => chip(slot.key, slot.id))}</AnimatePresence>}
    {more > 0 && <Popover boundarySelector="[data-palside-app]" align="end">
      <PopoverTrigger asChild onPointerDown={fitColumn} onKeyDown={fitColumn}><button type="button" className={s.more} aria-label={t('extension.top.more', { count: more })} title={t('extension.top.more', { count: more })}>
        <b>+<Count value={more} /></b></button></PopoverTrigger>
      <PopoverContent aria-label={t('extension.top.more', { count: more })} className={s.morePopover}>
        <div className={s.moreList}>{hidden.map(key => chip(key, key, true))}</div>
      </PopoverContent>
    </Popover>}
  </div></motion.div>;
}

