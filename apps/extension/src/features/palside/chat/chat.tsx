'use client';
import { message as uiMessage } from '@palside/i18n';
import { Button } from '@palside/ui/button';
import { useLocale, useTranslations } from 'use-intl';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowLeft, AtSign, ChevronRight, MessageCircle } from 'lucide-react';
import { Count, CountText } from '../ui/motion-details';
import { WatchStrip } from '../viewing/watch-strip';
import { MoreTeamPayments, TeamPaymentCard, useTeamPayments } from '../wallet/team-feed';
import { useTopCard } from '../annotations/reminders';
import { AwayDivider, useAway } from './away-divider';
import { unreadMentions } from '../../../domain/chat/unread-mentions';
import { Composer } from './composer';
import { ReadonlyDraft } from '../feedback/readonly-draft';
import { ChatHeader } from './chat-header';
import { MessageItem } from './message-item';
import { NewTeam, showsNewTeam } from '../teams/new-team';
import { ReactionStage } from '../annotations/reaction-picker';
import { useChatTimeline } from './use-chat-timeline';
import { trailView } from './chat-reading';
import { FloatingDate } from './floating-date';
import { SendFlightContext, SendFlights, captureComposer } from './send-flight';
import { clearSearchMarks, setSearchMarks, textRanges } from './text-highlights';
import { personFor } from '../../../domain/account/model';
import { type Message, type QuoteRange } from '../../../domain/chat/model';
import type { PalsideController } from '../app/use-palside';
import navigation from './chat-navigation.module.css';
import s from '../app/palside.module.css';

/** Consecutive messages from one person within five minutes read as one group. */
const groupWindow = 5 * 60_000;
function continues(previous: Message | undefined, message: Message) {
  if (!previous || previous.author !== message.author) return false;
  return previous.timestamp === undefined || message.timestamp === undefined || message.timestamp - previous.timestamp < groupWindow;
}
function dayKey(timestamp?: number) { return timestamp === undefined ? '' : new Date(timestamp).toDateString(); }
function dayLabel(timestamp: number, locale: string, today: string) {
  const date = new Date(timestamp);
  if (date.toDateString() === new Date().toDateString()) return today;
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short', ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) }).format(date);
}

/**
 * The team conversation. `originLabel` names the screen a jump came from (search, shared items) when the first return
 * stop leads back there through `onReturn`; `searchQuery` marks that search's hits while reading from a result.
 */
export function Chat({ c, jumpId, clearJump, originLabel, onReturn, searchQuery, followLatest = false }: { c: PalsideController; jumpId?: string; clearJump: () => void; originLabel?: string; onReturn?: () => void; searchQuery?: string; followLatest?: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const payments = useTeamPayments(c);
  const reduced = useReducedMotion();
  const list = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [flights] = useState(() => new SendFlights());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const onLeave = useCallback((id: string, on: boolean) => setLeaving(old => { if (old.has(id) === on) return old; const next = new Set(old); if (on) next.add(id); else next.delete(id); return next; }), []);
  const flight = useMemo(() => ({ flights, layer: () => layer.current, list: () => list.current }), [flights]);
  const timeline = useChatTimeline({ self: c.data.self, teamId: c.current, messages: c.currentMessages, active: c.screen === 'chat', command: c.live?.command, jumpId, listRef: list, contentRef: content });
  const readIds = c.live?.state.remoteTeams.find(team => team.id === c.current)?.preferences.readIds ?? [];
  const mentions = unreadMentions(c.currentMessages, c.data.self, readIds, c.now);
  const newestId = c.currentMessages.at(-1)?.id;
  const scrollToLatest = timeline.latest;
  useLayoutEffect(() => { if (followLatest) scrollToLatest(); }, [followLatest, newestId, scrollToLatest]);
  const currentTeamId = c.current;
  const live = c.live;
  const historyLoading = live?.state.history?.[currentTeamId]?.loading;
  const historyLoaded = live?.state.history?.[currentTeamId]?.loaded;
  useEffect(() => {
    const root = list.current;
    if (!root || !live) return;
    let requested = false;
    const onScroll = () => {
      if (root.scrollTop > 24) return;
      const history = live.state.history?.[currentTeamId];
      if (requested || history?.loaded || history?.loading) return;
      requested = true;
      void live.command('history', { teamId: currentTeamId }).catch(() => { requested = false; });
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [currentTeamId, live, historyLoading, historyLoaded]);
  // Reader input settles every send flight at its destination at once.
  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const settle = () => flights.finishAll();
    for (const name of ['wheel', 'pointerdown', 'keydown'] as const) root.addEventListener(name, settle, { passive: true });
    return () => { for (const name of ['wheel', 'pointerdown', 'keydown'] as const) root.removeEventListener(name, settle); flights.finishAll(); };
  }, [flights]);
  const target = timeline.target;
  const marking = c.screen === 'chat' ? searchQuery?.trim() : undefined;
  useEffect(() => {
    const root = content.current;
    if (!marking || !root) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const current = target ? root.querySelector(`[data-message-id="${CSS.escape(target)}"] [data-message-text]`) : null;
      const soft: Range[] = [], strong: Range[] = [];
      for (const element of root.querySelectorAll('[data-message-text]')) (element === current ? strong : soft).push(...textRanges(element, marking));
      setSearchMarks(soft, strong);
    };
    paint();
    // Rows mount, fold and load history while reading; ranges follow the text they cover.
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(paint); });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clearSearchMarks(); };
  }, [marking, target]);
  function bottom() { timeline.latest(); clearJump(); list.current?.focus({ preventScroll: true }); }
  // The quoted part to mark when a partial quote's jump lands; any other jump marks the whole message.
  const [quoted, setQuoted] = useState<{ id: string; range: QuoteRange }>();
  function scrollToMessage(id: string, range?: QuoteRange) {
    setQuoted(range ? { id, range } : undefined);
    if (!timeline.jump(id)) c.setNotice(uiMessage('extension.copy.messageUnavailable'));
  }
  function returnTo(index: number) {
    timeline.returnTo(index);
    if (index === 0) { clearJump(); onReturn?.(); }
  }
  const input = useRef<HTMLTextAreaElement>(null);
  const top = useTopCard(c);
  const away = useAway(c);
  function changeTeam(id: string) { c.chooseTeam(id); clearJump(); }
  async function send() {
    const follow = timeline.sendIntent();
    let armedId: string | undefined, sent = false;
    try {
      sent = await c.send(message => {
        // Measured while the composer still shows the text; the new row plays the flight when it mounts.
        const field = input.current, surface = field?.closest<HTMLElement>('[data-composer-surface]');
        if (reduced || !message.text || !field || !surface) return;
        const source = captureComposer(field, surface, message.text);
        if (source) { armedId = message.clientId ?? message.id; flights.arm(armedId, source, () => { const moved = follow(); if (moved) clearJump(); return moved; }); }
      });
    } finally { if (!sent && armedId) flights.done(armedId); }
    if (sent && follow()) clearJump();
    if (input.current?.checkVisibility()) input.current.focus();
  }
  const queue = live?.state.sendQueue?.[c.current];
  const queued = new Map(queue?.items.map((item, index) => [item.id, { at: item.at, head: index === 0 }]));
  const stops = timeline.canReturn ? timeline.trail.split('\n') : [];
  const nameOf = (id: string) => personFor(c.people, c.currentMessages.find(message => message.id === id)?.author ?? '', t('common.member')).name;
  const stopLabel = (index: number) => index === 0 ? originLabel ?? t('extension.reading.origin') : nameOf(stops[index]!);
  const days: { key: string; label?: string; items: ReactNode[] }[] = [];
  const dayOf = new Map<string, string>();
  const entries = [...c.currentMessages.map(message => ({ id: message.id, timestamp: message.timestamp, message })), ...payments.map(payment => ({ id: payment.id, timestamp: payment.timestamp, payment }))].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  let previous: Message | undefined;
  entries.forEach(entry => {
    const key = dayKey(entry.timestamp) || 'undated';
    if (days.at(-1)?.key !== key) {
      days.push({ key, label: entry.timestamp === undefined ? t('extension.copy.today') : dayLabel(entry.timestamp, locale, t('extension.copy.today')), items: [] });
      previous = undefined;
    }
    const day = days[days.length - 1]!;
    if ('payment' in entry) {
      day.items.push(<TeamPaymentCard key={`payment-${entry.id}`} c={c} item={entry.payment} />);
      previous = undefined;
      return;
    }
    const { message } = entry;
    const label = day.label ?? days.findLast(item => item.label)?.label;
    if (label) dayOf.set(message.id, label);
    if (c.live && message.id === away.first) day.items.push(<AwayDivider key="away" c={c} views={away.views} />);
    day.items.push(<MessageItem key={`message-${message.clientId ?? message.id}`} c={c} message={message} grouped={continues(previous, message)} onLeave={onLeave}
      landing={target === message.id ? timeline.landing : undefined} queued={queued.get(message.clientId ?? message.id)}
      landingRange={target === message.id && quoted?.id === message.id ? quoted.range : undefined}
      onReply={range => { c.updateDraft({ replyTo: message.id, replyRange: range }); input.current?.focus(); }} onQuote={scrollToMessage} />);
    // A recall notice does not split a group; a dissolving message counts until it has gone.
    if (!message.recalled || leaving.has(message.id)) previous = message;
  });
  return <div className={s.chat} hidden={c.screen !== 'chat'}><SendFlightContext value={flight}><ReactionStage c={c}>
    <ChatHeader c={c} onTeam={changeTeam} />
    <WatchStrip key={c.current} c={c} top={top} />
    <div className={navigation.viewport}>
    <div ref={list} className={`${s.timeline} ${navigation.list}`} aria-label={t('extension.copy.chatMessages')} tabIndex={0}>
    <div ref={content} className={`${navigation.content} ${!c.currentMessages.length ? navigation.emptyContent : ''}`}>

      {c.currentMessages.length > 0 && c.live?.state.history?.[c.current]?.loading && <div className={s.historyStatus} role="status" aria-live="polite">{t('extension.copy.loading')}</div>}
      {!c.currentMessages.length && !payments.length && <div className={s.empty}>{showsNewTeam(c)
        ? <NewTeam c={c} />
        : c.canWrite ? <NewTeam c={c} invite={false} /> : <><MessageCircle size={24} strokeWidth={1.3} /><h2>{t('extension.copy.noViewableMessages')}</h2></>}</div>}
      <MoreTeamPayments c={c} />
      {days.map(day => <div key={day.key} className={s.day}>
        {day.label && <div className={s.dateLabel} data-day-label><span>{day.label}</span></div>}
        <AnimatePresence initial={false}>{day.items}</AnimatePresence>
      </div>)}
    </div>
    </div>
    <FloatingDate list={list} labelOf={id => dayOf.get(id)} />
    {(timeline.away || stops.length > 0 || mentions.length > 0) && <nav className={navigation.navigation} aria-label={t('extension.copy.readingNavigation')}>
      {mentions[0] && <Button size="sm" variant="surface" className={navigation.button} style={{ minHeight: 34, padding: '7px 12px' }} aria-label={t('extension.composer.unreadMentions', { count: mentions.length })} title={t('extension.composer.unreadMentions', { count: mentions.length })} onClick={() => scrollToMessage(mentions[0]!.id)}><span className={navigation.buttonContent}><AtSign size={14} className={navigation.buttonIcon} /><span className={navigation.buttonLabel}><Count value={mentions.length} /></span></span></Button>}
      {stops.length > 0 && <div className={navigation.trail} role="group" aria-label={t('extension.reading.trail')}>
        <ArrowLeft size={14} className={navigation.trailIcon} aria-hidden="true" />
        {trailView(stops).map(({ index, gap }) => <Fragment key={index}>
          {gap ? <span className={navigation.gap} aria-hidden="true">…</span>
            : <button type="button" className={navigation.stop} onClick={() => returnTo(index)} aria-label={t('extension.reading.returnTo', { name: stopLabel(index) })}>{stopLabel(index)}</button>}
          <ChevronRight size={14} className={navigation.separator} aria-hidden="true" />
        </Fragment>)}
        <b className={navigation.here} aria-current="location">{target ? nameOf(target) : t('extension.reading.origin')}</b>
      </div>}
      {timeline.away && <Button size="sm" variant="surface" className={`${navigation.button} ${navigation.latest}`} style={{ minHeight: 34, padding: '7px 12px' }} onClick={bottom} aria-label={timeline.newCount ? t('extension.dynamic.newMessagesLatest', { count: (timeline.newCount) ?? '' }) : t('extension.copy.latest')}><span className={navigation.buttonContent}><ArrowDown size={14} className={navigation.buttonIcon} /><span className={navigation.buttonLabel} aria-live="polite" aria-atomic="true">{timeline.newCount ? <CountText text={t('extension.dynamic.newMessages', { count: timeline.newCount })} value={timeline.newCount} /> : t('extension.copy.latest')}</span></span></Button>}
    </nav>}
    </div>
    {c.canWrite ? <Composer c={c} inputRef={input} onSend={send} /> : <ReadonlyDraft c={c} />}
    <div ref={layer} className={s.flightLayer} aria-hidden="true" />
  </ReactionStage></SendFlightContext></div>;
}
