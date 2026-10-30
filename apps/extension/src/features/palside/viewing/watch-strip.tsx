'use client';
import { Spinner } from '@palside/ui/spinner';
import { errorMessage, message as uiMessage } from '@palside/i18n';

import { useTranslations } from 'use-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { ArrowUpRight, ChevronDown, Copy } from 'lucide-react';
import { motionPresets } from '@palside/design/motion';
import { Tooltip } from '@palside/ui/tooltip';
import { Popover, PopoverTrigger, PopoverContent, usePopoverContext } from '@palside/ui/popover';
import { shortAddress } from '@palside/shared/navigation';
import { PersonAvatar, Token } from '../ui/primitives';
import { captureSocialUi, openWithReturn } from '../annotations/social-state';
import { PokeRow, type TopCard } from '../annotations/reminders';
import type { Person } from '../../../domain/account/model';
import { ChainLogo } from '../assets/chain-identity';
import { SiteLogo } from '../assets/site-logo';
import { siteForUrl } from '../settings/site-catalog';
import { Count, CountText } from '../ui/motion-details';
import { rankedKeys, sourceLabel, watchGroups, type WatchGroup, type WatchSource } from './watch-groups';
import type { PalsideController } from '../app/use-palside';
import s from './watch-strip.module.css';

function linkHint(input: string, home: string) {
  const url = new URL(input);
  return `${url.host}\n${url.pathname === '/' && !url.search && !url.hash ? home : `${url.pathname}${url.search}${url.hash}`}`;
}

type WatchChipProps = { group: WatchGroup; c: PalsideController; onMenu: (open: boolean) => void; onOpenPage?: (url: string) => void; merges: string[]; pop: string[] };

function WatchChip(props: WatchChipProps) {
  return <Popover boundarySelector="[data-palside-app]" align="start"><WatchChipContent {...props} /></Popover>;
}

function WatchChipContent({ group, c, onMenu, onOpenPage, merges, pop }: WatchChipProps) {
  const t = useTranslations();
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
  const caption = multiple ? <CountText text={t('extension.dynamic.sourceCount', { count: group.sources.length })} value={group.sources.length} /> : group.view.kind === 'asset' ? single?.view.source : single?.view.disclosure === 'page' ? t('extension.copy.currentPage') : t('extension.copy.websiteHome');
  useEffect(() => { if (!present) { const focused = menuOpen.current || layerRef.current?.contains(document.activeElement) || anchorRef.current === document.activeElement; close(false); onMenu(false); if (focused) anchorRef.current?.closest('[data-palside-app]')?.querySelector<HTMLTextAreaElement>('[data-message-input]')?.focus({ preventScroll: true }); } }, [present, close, onMenu, layerRef, anchorRef]);
  useEffect(() => () => { if (menuOpen.current) owner.current?.querySelector<HTMLTextAreaElement>('[data-message-input]')?.focus({ preventScroll: true }); onMenu(false); }, [onMenu]);
  async function open(url: string) {
    if (openingRequest.current || !present) return;
    const session = captureSocialUi();
    openingRequest.current = true; setOpening(url);
    try {
      if (onOpenPage) await onOpenPage(url);
      else if (c.live) await openWithReturn(c.live, url);
      else window.open(url, '_blank', 'noopener,noreferrer');
      if (session.current()) close();
    } catch (error) { if (session.current()) c.setNotice(error instanceof Error ? errorMessage(error) : uiMessage('extension.copy.openPageFailed')); }
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
  const rows = menu ? [...menu.map(old => group.sources.find(source => source.key === old.key) ?? { ...old, members: [] }), ...group.sources.filter(source => !menu.some(old => old.key === source.key))] : [];
  return <motion.div layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduced ? motionPresets.reduced : motionPresets.reorder} className={s.chip} data-together={group.members.some(member => member.id === c.data.self) || undefined} aria-hidden={!present || undefined} data-watch-key={group.key}>
    <Tooltip content={group.view.kind === 'asset' ? `${group.view.chain} · ${group.view.name}\n${group.view.address ? shortAddress(group.view.address) : ''}\n${multiple ? t('extension.copy.selectSource') : t('extension.dynamic.openSource', { name: (single?.view.source ?? t('extension.copy.sourcePage')) ?? '' })}` : multiple ? t('extension.copy.selectPage') : single ? linkHint(single.url, t('extension.copy.websiteHome')) : group.view.name}>
      <button ref={anchorRef} className={s.target} type="button" disabled={!present} aria-busy={Boolean(opening) || undefined} aria-disabled={Boolean(opening) || undefined} aria-label={opening ? t('extension.dynamic.openingPage', { name: (group.view.name) ?? '' }) : t('extension.dynamic.openSource', { name: (group.view.name) ?? '' })} aria-haspopup={multiple || menu ? 'dialog' : undefined} aria-expanded={multiple || menu ? Boolean(menu) : undefined} onPointerDown={() => { pressed.current = signature; }} onPointerCancel={() => { pressed.current = undefined; }} onKeyDown={() => { pressed.current = signature; }} onClick={activate}>
        <Token view={group.view} size="sm" /><span className={s.text}><strong>{group.view.name}</strong><small>{caption}{opening ? <Spinner size={12} className={s.loadingIcon} /> : multiple || menu ? <ChevronDown size={12} /> : <ArrowUpRight size={12} />}</small></span>
      </button>
    </Tooltip>
    <Tooltip content={t('extension.copy.viewWatchers')}><button className={s.count} disabled={!present || Boolean(onOpenPage)} aria-label={t('extension.dynamic.viewingPeople', { name: (group.view.name) ?? '', count: (group.members.length) ?? '' })} onClick={() => { c.setMemberFilter(group.key); c.go('members'); }}><AvatarStack c={c} members={group.members} pop={pop} /></button></Tooltip>
    {merges.map(merge => <MergeEffect key={merge} />)}
    <PopoverContent aria-label={t('extension.dynamic.sourcesFor', { name: (group.view.name) ?? '' })} className={s.menu}
      onToggle={event => { if (event.target !== event.currentTarget) return; const shown = event.newState === 'open'; menuOpen.current = shown; if (shown) owner.current = anchorRef.current?.closest('[data-palside-app]') ?? null; onMenu(shown); if (!shown) setMenu(null); else layerRef.current?.focus({ preventScroll: true }); }}>
      {group.view.kind === 'asset' && group.view.address && <div className={s.contractRow}><Tooltip content={t('extension.copy.copyContract')}><button type="button" className={s.contract} aria-label={t('extension.dynamic.copyChainContract', { chain: (group.view.chain) ?? '', address: (group.view.address) ?? '' })} onClick={() => { if (group.view.address) void navigator.clipboard.writeText(group.view.address).catch(() => c.setNotice(uiMessage('extension.copy.copyFailed'))); }}>{group.view.chain && <ChainLogo chain={group.view.chain} />}<code>{shortAddress(group.view.address)}</code><Copy size={12} /></button></Tooltip></div>}
      {rows.map(source => { const active = present && source.members.length > 0; const target = <button className={s.sourceTarget} disabled={!active} aria-busy={opening === source.url || undefined} aria-disabled={Boolean(opening) || undefined} onClick={() => { const current = group.sources.find(item => item.key === source.key); if (present && current?.members.length) { void open(current.url); } }}>
          <SiteLogo site={siteForUrl(source.url, c.sites)} size="xs" /><span className={s.sourceText}>{sourceLabel(source, t)}{group.view.kind === 'asset' && group.sources.filter(item => item.view.source === source.view.source).length > 1 && <small>{new URL(source.url).pathname.split('/').at(-1)?.slice(0,8)}…</small>}</span><small>{active ? <CountText text={t('extension.dynamic.peopleCount', { count: source.members.length })} value={source.members.length} /> : t('extension.copy.leftTeam')}</small>{opening === source.url ? <Spinner size={13} className={s.loadingIcon} /> : <ArrowUpRight size={13} />}
        </button>; return <div key={source.key} className={s.source}>
        {source.view.kind === 'asset' ? target : <Tooltip content={active ? linkHint(source.url, t('extension.copy.websiteHome')) : t('extension.copy.leftTeam')}>{target}</Tooltip>}
        <Tooltip content={t('extension.copy.copyLink')}><button className={s.copy} disabled={!active} aria-label={t('extension.dynamic.copySourceLink', { name: (sourceLabel(source, t)) ?? '' })} onClick={() => { if (present && group.sources.some(item => item.key === source.key)) void navigator.clipboard.writeText(source.url).catch(() => c.setNotice(uiMessage('extension.copy.copyFailed'))); }}><Copy size={13} /></button></Tooltip>
      </div>; })}
    </PopoverContent>
  </motion.div>;
}

/** Up to two faces — the user first when they are here too (ringed) — then a +N disc for everyone else. */
function AvatarStack({ c, members, pop }: { c: PalsideController; members: Person[]; pop: string[] }) {
  const reduced = useReducedMotion();
  const ordered = [...members.filter(member => member.id === c.data.self), ...members.filter(member => member.id !== c.data.self)];
  const faces = ordered.slice(0, 2); const rest = ordered.length - faces.length;
  const spring = (id: string) => reduced ? motionPresets.reduced : { type: 'spring' as const, bounce: 0, visualDuration: 0.24, delay: pop.includes(id) ? 0.12 : 0 };
  return <span className={s.stack} aria-hidden="true">
    <AnimatePresence initial={false} mode="popLayout">{faces.map(face => <motion.span key={face.id} layout="position" className={s.face} data-self={face.id === c.data.self || undefined}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }} transition={spring(face.id)}>
      <PersonAvatar person={face} size="xs" />
    </motion.span>)}
    {rest > 0 && <motion.span key="rest" layout="position" className={s.rest} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduced ? motionPresets.reduced : motionPresets.feedback}>+<Count value={rest} /></motion.span>}
    </AnimatePresence>
  </span>;
}

function MergeEffect() {
  return <motion.span className={s.merge} aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 1.7, times: [0, 0.12, 0.6, 1] }} />;
}

/** Merge lifetimes belong to the strip, including chips hidden by the top card or removed groups. */
function useMergeExpiry(merges: { id: string }[], onDone: (id: string) => void) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const active = new Set(merges.map(merge => merge.id));
    for (const [id, timer] of timers.current) if (!active.has(id)) { clearTimeout(timer); timers.current.delete(id); }
    for (const { id } of merges) if (!timers.current.has(id)) timers.current.set(id, setTimeout(() => { onDone(id); }, 1_800));
  }, [merges, onDone]);
  useEffect(() => {
    const current = timers.current;
    return () => { for (const timer of current.values()) clearTimeout(timer); current.clear(); };
  }, []);
}

/** The top slot under the team header: one 52px row. Usually the 在看 chips in equal columns — two at most, the rest under a +N square;
 *  a 跟看 / 喊你来看 / connection card takes the row instead, and what it covers moves under +N. Same height either way. */
export function WatchStrip({ c, onOpenPage, top }: { c: PalsideController; onOpenPage?: (url: string) => void; top?: TopCard }) {
  const t = useTranslations();
  const people = c.people.filter(person => c.team.memberIds.includes(person.id));
  const groups = c.disconnected || c.team.readonly ? [] : watchGroups(people, c.data.views);
  const filled = Boolean(top) || groups.length > 0;
  const [holdSpace, setHoldSpace] = useState(filled);
  if (filled && !holdSpace) setHoldSpace(true);
  useEffect(() => { if (filled) return; const timeout = setTimeout(() => setHoldSpace(false), 1200); return () => clearTimeout(timeout); }, [filled]);
  const retainingSpace = !filled && holdSpace && c.toggles.share;
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
  const memberSignature = groups.map(group => `${group.key}:${group.members.map(member => member.id).sort().join(',')}`).join('|');
  const [seen, setSeen] = useState<{ signature: string; members: Map<string, Set<string>>; n: number }>();
  const [merges, setMerges] = useState<{ id: string; key: string; joiners: string[] }[]>([]);
  if (seen?.signature !== memberSignature) {
    const found: { id: string; key: string; joiners: string[] }[] = [];
    let n = seen?.n ?? 0;
    for (const group of seen ? groups : []) {
      const before = seen!.members.get(group.key) ?? new Set<string>();
      const members = group.members.map(member => member.id);
      const joiners = members.filter(member => !before.has(member));
      if (joiners.length && members.includes(c.data.self) && members.length >= 2) found.push({ id: `${group.key}-${++n}`, key: group.key, joiners: joiners.includes(c.data.self) ? members.filter(member => member !== c.data.self) : joiners });
    }
    setSeen({ signature: memberSignature, members: new Map(groups.map(group => [group.key, new Set(group.members.map(member => member.id))])), n });
    if (found.length) setMerges(old => [...old, ...found]);
  }
  const merged = useCallback((id: string) => setMerges(old => old.filter(merge => merge.id !== id)), []);
  useMergeExpiry(merges, merged);
  const keys = [...order.filter(key => groups.some(group => group.key === key)), ...rankedKeys(groups.filter(group => !order.includes(group.key)))];
  const chip = (key: string) => <WatchChip key={key} group={groups.find(group => group.key === key)!} c={c} onMenu={setMenu} onOpenPage={onOpenPage} merges={merges.filter(merge => merge.key === key).map(merge => merge.id)} pop={merges.filter(merge => merge.key === key).flatMap(merge => merge.joiners)} />;
  const shown = top ? [] : keys.length > 2 ? keys.slice(0, 2) : keys;
  const hidden = top ? keys.filter(key => !top.person || !groups.find(group => group.key === key)!.members.some(member => member.id === top.person)) : keys.slice(shown.length);
  const waiting = top?.waiting ?? [];
  const more = hidden.length + waiting.length;
  const columns = [...top ? ['minmax(0,1fr)'] : shown.map(() => 'minmax(0,1fr)'), ...more ? ['var(--watch-more)'] : []].join(' ');
  return <motion.div className={s.region} initial={false} animate={{ height: retainingSpace || filled ? 60 : 0, opacity: filled ? 1 : 0 }} transition={reduced ? motionPresets.reduced : motionPresets.feedback} inert={!filled} aria-hidden={!filled || undefined}>
  <div data-watch-strip className={s.strip} style={{ gridTemplateColumns: columns }} aria-label={t('extension.copy.teamViewing')} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onFocusCapture={() => setFocus(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocus(false); }} data-reduced-motion={Boolean(reduced)}>
    {top ? <motion.div key={top.key} className={s.card} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={reduced ? motionPresets.reduced : motionPresets.feedback}>{top.card}</motion.div>
      : <AnimatePresence initial={false}>{shown.map(chip)}</AnimatePresence>}
    {more > 0 && <Popover boundarySelector="[data-palside-app]" align="start">
      <PopoverTrigger asChild><button type="button" className={s.more} aria-label={t('extension.top.more', { count: more })} title={t('extension.top.more', { count: more })}><b>+<Count value={more} /></b></button></PopoverTrigger>
      <PopoverContent aria-label={t('extension.top.more', { count: more })} className={s.morePopover}>
        <MoreViewing c={c} waiting={waiting}>{hidden.map(chip)}</MoreViewing>
      </PopoverContent>
    </Popover>}
  </div></motion.div>;
}

function MoreViewing({ c, waiting, children }: { c: PalsideController; waiting: TopCard['waiting']; children: ReactNode }) {
  const { close } = usePopoverContext();
  return <div className={s.moreList}>
    {waiting.map(poke => <PokeRow key={poke.id} c={c} poke={poke} onDone={close} />)}
    {children}
  </div>;
}
