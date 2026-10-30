'use client';
import { VisuallyHidden } from '@palside/ui/visually-hidden';
import { clockTime, localeOrEnglish, message as uiMessage } from '@palside/i18n';
import { useLocale, useTranslations } from 'use-intl';
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { CircleAlert, CircleSlash, Flag, MoreHorizontal, Pencil, Quote, Reply, RotateCcw, Trash2, X } from 'lucide-react';
import { motionPresets } from '@palside/design/motion';
import { useText } from '../ui/text';
import { AssetCard } from '../assets/asset-card';
import { MessageRef } from '../annotations/message-ref';
import { ReplyLine } from './composer-social';
import { MessageImage } from '../media/message-image';
import { messageParts } from '../../../domain/chat/mentions';
import { messageReportPreview } from '../feedback/report-preview';
import { assetView } from '../../../domain/assets/model';
import { characterLength, emojiOnly, quotedFragment, type Message, type QuoteRange } from '../../../domain/chat/model';
import { quotedText } from './quotes';
import { Action, PersonAvatar } from '../ui/primitives';
import { IconButton } from '@palside/ui/button';
import { Menu, MenuTrigger, MenuContent, MenuItem } from '@palside/ui/menu';
import menuStyles from './message-item.module.css';
import { SendFlightContext, playFlight } from './send-flight';
import { dissolve, fade } from './recall-dissolve';
import { focusRanges, offsetRange, selectionOffsets, textRanges } from './text-highlights';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';
import refStyles from './composer-social.module.css';

type Props = {
  c: PalsideController;
  message: Message;
  grouped: boolean;
  /** Changes each time a jump lands on this message. */
  landing?: number;
  /** The quoted part to mark when the landing came from a partial quote. */
  landingRange?: QuoteRange;
  /** Set while the message waits for its pacing slot; `head` is the next one out, counting down to `at`. */
  queued?: { at: number; head: boolean };
  /** Told while a recalled row is still dissolving, so neighbours keep their grouping until it has gone. */
  onLeave?: (id: string, leaving: boolean) => void;
  /** Reply to this message; with a range, quote that part of it. */
  onReply: (range?: QuoteRange) => void;
  onQuote: (id: string, range?: QuoteRange) => void;
};

/** Text longer than this many lines folds to `FOLDED_LINES` until expanded. */
const FOLD_LINES = 7;

/** A message recalled while on screen dissolves before its notice takes the place; one already recalled shows the notice. */
export function MessageItem(props: Props) {
  const { message } = props;
  const reduced = useReducedMotion();
  const [kept, setKept] = useState(message);
  const [phase, setPhase] = useState<{ name: 'live' | 'leaving' } | { name: 'gone'; from?: number }>(message.recalled ? { name: 'gone' } : { name: 'live' });
  const gone = useCallback((from: number) => setPhase({ name: 'gone', from }), []);
  if (!message.recalled && changed(kept, message)) setKept(message);
  if (message.recalled && phase.name === 'live') setPhase({ name: 'leaving' });
  const { onLeave } = props, leavingId = phase.name === 'leaving' ? message.id : undefined;
  useLayoutEffect(() => {
    if (!leavingId) return;
    onLeave?.(leavingId, true);
    return () => onLeave?.(leavingId, false);
  }, [leavingId, onLeave]);
  if (phase.name === 'leaving') return <MessageBody {...props} message={kept} leaving={{ reduced: Boolean(reduced), onGone: gone }} />;
  if (message.recalled) return <Tombstone message={message} from={phase.name === 'gone' ? phase.from : undefined} reduced={Boolean(reduced)} />;
  return <MessageBody {...props} />;
}

const changed = (a: Message, b: Message) => a.id !== b.id || a.text !== b.text || a.attachment !== b.attachment || a.ref !== b.ref || a.replyTo !== b.replyTo || a.editedAt !== b.editedAt || a.status !== b.status || a.time !== b.time;

function Tombstone({ message, from, reduced }: { message: Message; from?: number; reduced: boolean }) {
  const t = useTranslations();
  return <motion.div className={s.tombstone} data-message-id={message.id}
    initial={from === undefined ? false : { height: from, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
    transition={reduced ? motionPresets.reduced : motionPresets.feedback}>
    {message.removedByOwner ? t('extension.copy.messageRemoved') : t('extension.copy.messageRecalled')}
  </motion.div>;
}

/** One chat message: avatar, a bubble for words (reference, reply quote, text), attachments as their own
 * cards under it (token or page card, image), time and menu, then send failures. */
function MessageBody({ c, message, grouped, landing, landingRange, queued, onReply, onQuote, leaving }: Props & { leaving?: { reduced: boolean; onGone: (height: number) => void } }) {
  const t = useTranslations();
  const locale = useLocale();
  const reduced = useReducedMotion();
  const flight = useContext(SendFlightContext);
  const row = useRef<HTMLElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLParagraphElement>(null);
  const textId = useId();
  const key = message.clientId ?? message.id;
  // A row that a send flight will carry in skips its own entrance.
  const [flying] = useState(() => Boolean(!leaving && flight?.flights.peek(key)));
  const [expanded, setExpanded] = useState(false);
  const [toggled, setToggled] = useState(false);
  const person = c.people.find(p => p.id === message.author) ?? { id: message.author, name: t('common.member'), color: '#e9edf0' };
  const self = message.author === c.data.self;
  const asset = assetView(message.attachment);
  const original = c.currentMessages.find(m => m.id === message.replyTo);
  const editing = c.editing === message.id;
  const fragment = quotedFragment(original, message.replyRange, message.replyToExpiresAt);
  const jumbo = !editing && !message.ref && !message.replyTo && !message.attachment && emojiOnly(message.text);
  const long = useLongText(text, Boolean(message.text) && !editing && !jumbo, message.text, message.editedAt);
  const folded = long && !expanded;

  useLayoutEffect(() => {
    if (!flight) return;
    const entry = flight.flights.peek(key);
    if (!entry) return;
    // Fly into the bubble's final shape: wait for the fold measured in this same commit to render first.
    if (text.current && runsLong(text.current) !== long) return;
    const list = flight.list(), layer = flight.layer();
    if (!list || !layer || !row.current || !bubble.current) { flight.flights.done(key); return; }
    const shift = flight.flights.follow(entry, list);
    if (shift === null) { flight.flights.done(key); return; }
    flight.flights.finishAll();
    // A send from far up the history jumps to a different set of rows; there is nothing on screen to slide.
    return playFlight({ layer, list, row: row.current, bubble: bubble.current, source: entry.source, shift: shift < list.clientHeight ? shift : 0, track: animation => flight.flights.track(animation), onDone: () => flight.flights.done(key) });
  }, [flight, key, long]);

  const seenLanding = useRef(landing);
  useEffect(() => {
    if (landing === undefined || landing === seenLanding.current) return;
    seenLanding.current = landing;
    setExpanded(true);
    const frame = requestAnimationFrame(() => {
      const part = text.current && landingRange && (message.editedAt ?? 0) === landingRange.base ? offsetRange(text.current, landingRange.start, landingRange.end, message.text) : [];
      if (text.current && focusRanges(part.length ? part : textRanges(text.current))) return;
      const target = stack.current;
      if (!target) return;
      target.dataset.flash = '';
      setTimeout(() => { delete target.dataset.flash; }, 1700);
    });
    return () => cancelAnimationFrame(frame);
  }, [landing, landingRange, message.editedAt, message.text]);

  const onGone = leaving?.onGone, leavingReduced = leaving?.reduced;
  useEffect(() => {
    const element = stack.current, item = row.current;
    if (!onGone || !element || !item) return;
    // The whole row leaves together: surfaces turn to dust, avatar, name and time fade with the sweep.
    const fading = [item.firstElementChild, item.querySelector(`.${s.messageMeta}`), item.querySelector(`.${s.messageAside}`)].filter((node): node is HTMLElement => node instanceof HTMLElement);
    const run = leavingReduced
      ? fade(element, fading.map(node => node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' })))
      : dissolve(element, flight?.layer() ?? null, fading, self);
    let live = true;
    void run.finished.catch(() => {}).then(() => { if (live) onGone(item.offsetHeight); });
    return () => { live = false; run.cancel(); };
  }, [onGone, leavingReduced, flight, self]);

  // When the head of a group goes, the next message takes over its avatar and name; they ease in rather than pop.
  const [wasGrouped, setWasGrouped] = useState(grouped);
  const [taking, setTaking] = useState(false);
  if (wasGrouped !== grouped) { setWasGrouped(grouped); setTaking(wasGrouped && !grouped && !reduced); }

  function collapse() {
    setExpanded(false);
    requestAnimationFrame(() => row.current?.scrollIntoView({ block: 'nearest' }));
  }

  const className = [s.message, self && s.selfMessage, grouped && s.groupedMessage].filter(Boolean).join(' ');
  return <motion.article ref={row} className={className} data-message-id={message.id} inert={Boolean(leaving)} aria-hidden={leaving ? true : undefined}
    initial={flying ? false : { opacity: 0, y: reduced ? 0 : 9, scale: reduced ? 1 : .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
    transition={reduced ? motionPresets.reduced : { type: 'spring', stiffness: 360, damping: 32, mass: .8 }}>
    {grouped
      ? <span className={s.avatarGap} aria-hidden="true" />
      : taking ? <span className={s.takeOver}><PersonAvatar person={person} onClick={c.people.some(item => item.id === person.id) ? () => c.setPersonId(person.id) : undefined} /></span> : <PersonAvatar person={person} onClick={c.people.some(item => item.id === person.id) ? () => c.setPersonId(person.id) : undefined} />}
    <div className={s.messageContent}>
      {!self && !grouped && <div className={`${s.messageMeta} ${taking ? s.takeOver : ''}`}><strong>{person.name}</strong></div>}
      <div className={s.messageLine}>
        <div ref={stack} className={s.messageStack} data-sending={message.status === 'sending' && !queued} data-queued={queued ? true : undefined} aria-busy={message.status === 'sending'}>
          {(message.ref || message.replyTo || message.text) && <div ref={bubble} className={`${s.messageBubble} ${jumbo ? s.jumbo : ''}`} data-editing={editing || undefined} data-size={jumbo ? Math.min(characterLength(message.text.replace(/\s+/g, '')), 2) : undefined}>
            {queued?.head && !reduced && !jumbo && <QueueFill key={queued.at} at={queued.at} />}
            {message.ref && <MessageRef c={c} message={{ ...message, ref: message.ref }} />}
            {message.replyTo && <button type="button" className={refStyles.refChip} data-reply-quote onClick={() => original && onQuote(original.id, fragment ? message.replyRange : undefined)}>
              <ReplyLine c={c} original={original} text={quotedText(original, message.replyToExpiresAt, undefined, t)} fragment={fragment} />
            </button>}
            {message.text && <p ref={text} id={textId} className={s.messageText} data-message-text data-folded={folded || undefined} data-toggled={toggled || undefined}><LinkedText c={c} message={message} /></p>}
            {long && !editing && <button type="button" className={s.foldToggle} aria-expanded={expanded} aria-controls={textId} onClick={() => { setToggled(true); if (expanded) collapse(); else setExpanded(true); }}>{expanded ? t('extension.reading.collapse') : t('extension.reading.expand')}</button>}
          </div>}
          {asset && <AssetCard view={asset} onOpen={() => c.selectAsset(asset.id)} />}
          {/* A token card whose details did not come through still takes its place, so the message never reads as empty. */}
          {message.attachment?.kind === 'asset' && !asset && <div className={s.assetGone}><CircleSlash size={16} aria-hidden="true" />{t('extension.copy.tokenGone')}</div>}
          {message.attachment?.kind === 'image' && <MessageImage c={c} id={message.id} image={message.attachment} />}
        </div>
        <div className={`${s.messageAside} ${menuStyles.aside}`}>
          {/* The day label above already names the day, so the time here stays a short clock and every bubble gets the same width. */}
          <time dateTime={message.timestamp !== undefined ? new Date(message.timestamp).toISOString() : undefined} title={message.time}>{message.timestamp !== undefined ? clockTime(message.timestamp, localeOrEnglish(locale)) : message.time}</time>
          {message.edited && <small>{t('extension.copy.edited')}</small>}
          <span className={`${s.messageMenu} ${menuStyles.menuTrigger}`}>{c.canWrite && message.status === 'sent' && !leaving && <MessageMenu c={c} message={message} text={text} onReply={onReply} />}</span>
        </div>
      </div>
      {message.status === 'sending' && !leaving && <VisuallyHidden role="status">{queued ? t('extension.reading.queued') : t('extension.copy.sending')}</VisuallyHidden>}
      {['failed', 'waiting', 'uncertain'].includes(message.status) && !leaving && <FailureActions c={c} message={message} />}
    </div>
  </motion.article>;
}

const runsLong = (element: HTMLElement) => element.scrollHeight > (parseFloat(getComputedStyle(element).lineHeight) || 22) * FOLD_LINES + 1;

/** Whether the text runs past the fold, measured on its full height so folding never changes the answer. */
function useLongText(text: RefObject<HTMLElement | null>, enabled: boolean, content: string, revision?: number) {
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const element = text.current;
    if (!element || !enabled) return;
    // Measured before the first paint so a long message never shows unfolded; later rewraps come from the observer.
    // A hidden chat measures zero; keep the last answer so returning to it never reflows a jump target.
    const measure = () => { if (element.clientWidth) setLong(runsLong(element)); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, enabled, content, revision]);
  return enabled && long;
}

/** The head of the send queue fills with the sent colour from its trailing edge, arriving full when its slot opens. */
function QueueFill({ at }: { at: number }) {
  const [duration] = useState(() => Math.max(0, at - Date.now()));
  return <span className={s.queueFill} aria-hidden="true" style={{ animationDuration: `${duration}ms` }} />;
}

function LinkedText({ c, message }: { c: PalsideController; message: Message }) {
  return <>{messageParts(message.text, c.people, message.mentionIds).map((part, i) => {
    if (part.url) return <a key={i} href={part.text} target="_blank" rel="noreferrer noopener">{part.text}</a>;
    if (part.personId) return <button key={i} className={s.mentionLink} onClick={() => c.setPersonId(part.personId)}>{part.text}</button>;
    return <span key={i}>{part.text}</span>;
  })}</>;
}

const opensMenu = (target: EventTarget) => target instanceof Element && Boolean(target.closest('[aria-haspopup]'));

/** Text selected inside the message when its menu opens turns Reply into a quote of that part. */
function MessageMenu({ c, message, text, onReply }: { c: PalsideController; message: Message; text: RefObject<HTMLElement | null>; onReply: (range?: QuoteRange) => void }) {
  const t = useTranslations();
  const self = message.author === c.data.self;
  const [selected, setSelected] = useState<QuoteRange>();
  // Read on the press that opens the menu, before focus moves; a selection of the whole text is a plain reply.
  function capture() {
    const offsets = text.current ? selectionOffsets(text.current, message.text) : undefined;
    setSelected(offsets && (offsets[0] > 0 || offsets[1] < message.text.length) ? { start: offsets[0], end: offsets[1], base: message.editedAt ?? 0 } : undefined);
  }
  const summary = message.text.slice(0, 15) || (message.attachment?.kind === 'image' ? t('extension.copy.image') : t('extension.copy.tokenCard'));
  function report() {
    const image = message.attachment?.kind === 'image' && message.attachment.src ? { src: message.attachment.src, name: message.attachment.name } : undefined;
    c.setReportTarget({ kind: 'message', targetId: message.id, author: message.author, image, preview: messageReportPreview(message, t) });
    c.go('report');
  }
  return <span className={s.menuCapture} onPointerDownCapture={event => { if (opensMenu(event.target)) capture(); }} onKeyDownCapture={event => { if ((event.key === 'Enter' || event.key === ' ') && opensMenu(event.target)) capture(); }}><Menu boundarySelector="[data-palside-app]" align="end">
    <MenuTrigger asChild><IconButton label={t('extension.dynamic.messageActions', { content: summary })} size="xs" variant="quiet"><MoreHorizontal size={16} /></IconButton></MenuTrigger>
    <MenuContent aria-label={t('extension.dynamic.messageActions', { content: summary })} className={menuStyles.menu}>
      <MenuItem className={menuStyles.item} icon={selected ? <Quote size={16} /> : <Reply size={16} />} onClick={() => { onReply(selected); getSelection()?.removeAllRanges(); }}>{selected ? t('extension.reading.quoteSelection') : t('extension.copy.reply')}</MenuItem>
      {c.live && !self && <MenuItem className={menuStyles.item} icon={<Flag size={16} />} onClick={report}>{t('extension.copy.reportMessage')}</MenuItem>}
      {self && <MenuItem className={menuStyles.item} icon={<Pencil size={16} />} onClick={() => { c.edit(message); }}>{t('extension.copy.edit')}</MenuItem>}
      {(self || c.team.owner === c.data.self) && <MenuItem className={menuStyles.item} icon={<Trash2 size={16} />} tone="danger" onClick={() => { c.recall(message); }}>{self ? t('extension.copy.recall') : t('extension.copy.remove')}</MenuItem>}
    </MenuContent>
  </Menu></span>;
}

function FailureActions({ c, message }: { c: PalsideController; message: Message }) {
  const t = useTranslations();
  const text = useText();
  const status = message.status;
  const label = status === 'uncertain' ? t('extension.copy.sendUnconfirmed') : status === 'waiting' ? t('extension.copy.waitingConnection') : t('extension.copy.messageNotSent');
  const state = status === 'uncertain' ? t('extension.copy.resultUnconfirmed') : status === 'waiting' ? t('extension.copy.waitingConnection') : t('extension.copy.notSent');
  const tip = status === 'uncertain' ? t('extension.copy.retryChecksMessage') : status === 'waiting' ? t('extension.copy.sendManuallyAfterReconnect') : t('extension.copy.notSent');
  const retryLabel = c.disconnected ? t('extension.copy.retryAfterReconnect') : status === 'uncertain' ? t('extension.copy.checkSendResult') : t('extension.copy.resend');
  function cancel() {
    if (!c.live) { c.setMessages(old => old.filter(m => m.id !== message.id)); return; }
    const stop = () => { void c.run('cancel-send', { id: message.id }); };
    if (status === 'uncertain') c.setConfirmation({ title: uiMessage('extension.copy.stopCheckingTitle'), description: uiMessage('extension.copy.stopCheckingDescription'), confirm: stop });
    else stop();
  }
  return <div className={s.failureActions} aria-label={label}>
    <span className={s.failureStatus} role="img" aria-label={text(message.failure) || state} title={text(message.failure) || tip}><CircleAlert size={14} /></span>
    <Action size="xs" label={retryLabel} onClick={() => c.retry(message)} disabled={!c.canWrite || c.disconnected}><RotateCcw size={14} /></Action>
    <Action size="xs" label={t('extension.copy.cancelUnsent')} onClick={cancel}><X size={14} /></Action>
  </div>;
}
