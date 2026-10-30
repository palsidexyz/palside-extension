'use client';
import { VisuallyHidden } from '@palside/ui/visually-hidden';
import { NICKNAME_LENGTH } from '@palside/shared/contracts/limits';
import { errorMessage, message as uiMessage, type TextValue } from '@palside/i18n';
import { ENGLISH_WORDS, PIN_LENGTH } from '@palside/shared/identity';
import { useTranslations } from 'use-intl';
import { Count } from '../ui/motion-details';
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, Check, Copy, Eye, ShieldAlert, Users } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { avatarPath, type DefaultAvatarName } from '@palside/shared/person-avatars';
import { Button } from '@palside/ui/button';
import { HelpTip } from '@palside/ui/tooltip';
import { Input, PinInput, Field } from '@palside/ui/field';
import { Action } from '../ui/primitives';
import { Brand } from '../ui/brand';
import { LanguageSetting } from '../settings/language-setting';
import { characterLength } from '../../../domain/chat/model';
import { useText, useTextState } from '../ui/text';
import type { PalsideController } from '../app/use-palside';
import edge from '../feedback/edge-states.module.css';
import o from './onboarding.module.css';

const words = new Set(ENGLISH_WORDS);
const failure = (error: unknown, fallback: string): TextValue => error instanceof Error ? errorMessage(error) : uiMessage(fallback);
export const onboardingScreens = ['welcome', 'new-account', 'confirm-phrase', 'restore', 'password', 'nickname'];

type StepKey = 'stepPhrase' | 'stepVerify' | 'stepPassword' | 'stepName';
/** Ordered steps of the current flow and the active index. Restore only grows a name step for accounts without one. */
function progress(c: PalsideController): { steps: StepKey[]; index: number } | undefined {
  const screen = c.working ? 'password' : c.screen;
  if (c.flow === 'restore' || screen === 'restore') {
    const steps: StepKey[] = c.screen === 'nickname' ? ['stepPhrase', 'stepPassword', 'stepName'] : ['stepPhrase', 'stepPassword'];
    const index = { restore: 0, password: 1, nickname: 2 }[screen as string];
    return index === undefined ? undefined : { steps, index };
  }
  const index = { 'new-account': 0, 'confirm-phrase': 1, password: 2, nickname: 3 }[screen as string];
  return index === undefined ? undefined : { steps: ['stepPhrase', 'stepVerify', 'stepPassword', 'stepName'], index };
}

/** Segmented progress: one bar per step, with the current step named once beside it. */
function Steps({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const state = progress(c);
  if (!state) return null;
  const current = state.steps[state.index]!;
  return <div className={o.progress}>
    <ol className={o.segments} aria-label={t('extension.copy.onboardingSteps')}>
      {state.steps.map((step, index) => {
        const status = index < state.index ? 'done' : index === state.index ? 'current' : 'upcoming';
        return <li key={step} data-state={status} aria-current={status === 'current' ? 'step' : undefined}><VisuallyHidden>{t(`extension.copy.${step}`)}</VisuallyHidden></li>;
      })}
    </ol>
    <span className={o.progressLabel} aria-hidden="true">{t(`extension.copy.${current}`)}<b>{state.index + 1}/{state.steps.length}</b></span>
  </div>;
}

/** Screen frame: progress, one heading that takes focus on arrival, content and actions pinned to the bottom. */
function Step({ title, lead, help, hero, footer, children, onSubmit }: { title: ReactNode; lead?: string; help?: { label: string; content: string }; hero?: ReactNode; footer?: ReactNode; children?: ReactNode; onSubmit?: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { const root = heading.current?.closest('section'); if (heading.current?.checkVisibility() && !root?.contains(document.activeElement)) heading.current.focus({ preventScroll: true }); }, []);
  const body = <>
    {hero}
    <div className={o.intro}>
      <h1 ref={heading} tabIndex={-1} data-step-heading>{title}</h1>
      {lead && <div className={o.lead}>{lead}{help && <HelpTip label={help.label} content={help.content} className={o.help} />}</div>}
    </div>
    {children}
    {footer && <div className={o.footer}>{footer}</div>}
  </>;
  return onSubmit ? <form className={o.step} onSubmit={event => { event.preventDefault(); onSubmit(); }}>{body}</form> : <div className={o.step}>{body}</div>;
}

/** Registering and connecting has no honest steps to name, so it is one quiet line that only appears if it takes a moment. */
function Working({ flow }: { flow: 'create' | 'restore' }) {
  const t = useTranslations();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <div className={o.working} role="status" aria-live="polite">
    <span className={o.workingMark} aria-hidden="true"><img src="/brand/palside.svg" alt="" draggable={false} /></span>
    <h1 ref={heading} tabIndex={-1}>{t(flow === 'create' ? 'extension.copy.createTitle' : 'extension.copy.restoreProgressTitle')}</h1>
    <span className={o.track} aria-hidden="true"><i /></span>
  </div>;
}

/* 共享在看 as the landing film draws it: every token shows two faces and the rest as +N, with the headcount. Four
   teammates hop between tokens; a newcomer takes a face slot (you first, then the latest arrival), rows re-sort by
   headcount, and the last switch restores the first frame. */
type WelcomeToken = 'cashcat' | 'pons' | 'chump';
type Watcher = 'you' | 'kai' | 'mia' | 'leo';
type WatchState = Record<Watcher, WelcomeToken>;
const welcomeRows: { token: WelcomeToken; name: string; site: string; siteName: string; base: number }[] = [
  { token: 'cashcat', name: 'CASHCAT', site: 'gmgn', siteName: 'GMGN', base: 7 },
  { token: 'pons', name: 'PONS', site: 'fomo', siteName: 'FOMO', base: 8 },
  { token: 'chump', name: 'CHUMP', site: 'dexscreener', siteName: 'DEX Screener', base: 5 },
];
/** Teammates who never move fill the face slots when no watcher is there. */
const welcomeFill: Record<WelcomeToken, DefaultAvatarName[]> = { cashcat: ['frog', 'cat'], pons: ['hoodie', 'duck'], chump: ['alien', 'ghost'] };
const watcherAvatar: Record<Watcher, DefaultAvatarName> = { you: 'robot', kai: 'mushroom', mia: 'rabbit', leo: 'pear' };
const watchers = Object.keys(watcherAvatar) as Watcher[];
const watchStates: WatchState[] = [
  { you: 'cashcat', leo: 'cashcat', mia: 'pons', kai: 'chump' },
  { you: 'cashcat', leo: 'pons', mia: 'pons', kai: 'chump' },
  { you: 'pons', leo: 'pons', mia: 'pons', kai: 'chump' },
  { you: 'pons', leo: 'pons', mia: 'pons', kai: 'cashcat' },
];
/** Milliseconds before each frame, on the landing film's 7.2 s loop. */
const watchBeats = [2100, 1700, 1700, 1700];

/** Frame index plus when each watcher last moved, so the latest arrival takes the second face slot. */
function useWatchLoop() {
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState({ index: 0, step: 0, seen: {} as Partial<Record<Watcher, number>> });
  useEffect(() => {
    if (reduced) return;
    let timer = 0;
    const next = (delay: number) => { timer = window.setTimeout(() => setFrame(current => {
      const index = (current.index + 1) % watchStates.length, step = current.step + 1, seen = { ...current.seen };
      for (const who of watchers) if (watchStates[current.index]![who] !== watchStates[index]![who]) seen[who] = step;
      next(watchBeats[(index + 1) % watchBeats.length]!);
      return { index, step, seen };
    }), delay); };
    next(1300);
    return () => window.clearTimeout(timer);
  }, [reduced]);
  return frame;
}

function WatchCard() {
  const t = useTranslations();
  const { index, seen } = useWatchLoop();
  const state = watchStates[index]!;
  const here = (token: WelcomeToken) => watchers.filter(who => state[who] === token);
  const total = (row: typeof welcomeRows[number]) => row.base + here(row.token).length;
  const order = [...welcomeRows].sort((a, b) => total(b) - total(a));
  const faces = new Map<DefaultAvatarName, { r: number; s: number; off: boolean }>();
  order.forEach((row, r) => [...here(row.token).sort((a, b) => Number(b === 'you') - Number(a === 'you') || (seen[b] ?? 0) - (seen[a] ?? 0)).map(who => watcherAvatar[who]), ...welcomeFill[row.token]]
    .forEach((name, j) => faces.set(name, { r, s: Math.min(j, 1) + 1, off: j > 1 })));
  return <div className={o.watchCard}>
    <div className={o.watchHead}><img src="/team-avatars/team-avatar-robot-duo.webp" alt="" draggable={false} /><b>{t('extension.copy.welcomeArtTeam')}</b><i className={o.live} /><span><Users size={13} />28</span></div>
    <div className={o.watchRows}>
      {welcomeRows.map(row => <div key={row.token} className={o.watchRow} style={{ ['--r' as string]: order.indexOf(row) }}>
        <span className={o.watchToken}><img src={`/tokens/${row.token}.webp`} alt="" draggable={false} /><img src="/chain-logos/robinhood.webp" alt="" draggable={false} /></span>
        <span className={o.watchName}><b>{row.name}</b><small><img src={`/site-logos/${row.site}.webp`} alt="" draggable={false} />{row.siteName}</small></span>
        <span className={o.watchMore}>+<Count value={total(row) - 2} /></span>
        <em className={o.watchCount}><b><Count value={total(row)} /></b> {t('extension.hot.watchingShort')}</em>
      </div>)}
      {[...faces].map(([name, face]) => <span key={name} className={o.watchFace} data-off={face.off || undefined} data-self={name === watcherAvatar.you || undefined} style={{ ['--r' as string]: face.r, ['--s' as string]: face.s }}>
        <img src={avatarPath(name)} alt="" draggable={false} />
      </span>)}
    </div>
  </div>;
}

/** The sky band under the header: it drifts against the pointer while the card tilts toward it; idle, both float. */
function WelcomeArt() {
  const hero = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const element = hero.current, area = element?.closest('section');
    if (!element || !area || reduced) return;
    let frame = 0, pointer: { x: number; y: number } | undefined, x = 0, y = 0;
    const start = performance.now();
    const move = (event: PointerEvent) => { const box = area.getBoundingClientRect(); pointer = { x: (event.clientX - box.left) / box.width * 2 - 1, y: (event.clientY - box.top) / box.height * 2 - 1 }; };
    const leave = () => { pointer = undefined; };
    const tick = (now: number) => {
      const seconds = (now - start) / 1000, target = pointer ?? { x: Math.sin(seconds * .42) * .5, y: Math.cos(seconds * .31) * .4 };
      x += (target.x - x) * .06; y += (target.y - y) * .06;
      element.style.setProperty('--px', x.toFixed(4)); element.style.setProperty('--py', y.toFixed(4));
      frame = requestAnimationFrame(tick);
    };
    area.addEventListener('pointermove', move); area.addEventListener('pointerleave', leave);
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); area.removeEventListener('pointermove', move); area.removeEventListener('pointerleave', leave); };
  }, [reduced]);
  return <div ref={hero} className={o.welcomeHero} aria-hidden="true">
    <div className={o.sky} />
    <div className={o.tilt}><WatchCard /></div>
  </div>;
}

/** The heading arrives one character at a time, as on the landing page. */
function Arriving({ text }: { text: string }) {
  return <><VisuallyHidden>{text}</VisuallyHidden><span className={o.arriving} aria-hidden="true">{[...text].map((char, index) => <span key={index} style={{ ['--i' as string]: index }}>{char}</span>)}</span></>;
}

function Welcome({ c }: { c: PalsideController }) {
  const t = useTranslations();
  return <Step title={<Arriving text={t('extension.copy.friendsAlongside')} />} lead={t('extension.copy.welcomeNote')} hero={<WelcomeArt />} footer={<>
    <Button variant="primary" size="lg" loading={c.authBusy} loadingLabel={t('common.working')} onClick={() => void c.startCreate()}>{t('extension.copy.createAccount')}</Button>
    <Button size="lg" onClick={() => c.go('restore')}>{t('extension.copy.haveAccount')}</Button>
  </>} />;
}

function NewPhrase({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const [revealed, setRevealed] = useState(false);
  return <Step title={t('extension.copy.backUpPhraseTitle')} lead={t('extension.copy.newPhraseHint')} footer={<Button variant="primary" size="lg" disabled={!revealed} onClick={() => c.go('confirm-phrase')}>{t('extension.copy.phraseBackedUp')}</Button>}>
    <div className={o.phraseCard} data-revealed={revealed || undefined}>
      <ol className={o.phrase} aria-hidden={!revealed || undefined}>{c.phrase.map((word, index) => <li key={index} style={{ ['--i' as string]: index }}><span>{index + 1}</span>{word}</li>)}</ol>
      {revealed ? <div className={o.phraseTools}><Button size="sm" leadingIcon={<Copy size={14} />} onClick={() => void c.copy(c.phrase.join(' '))}>{t('extension.copy.copyPhrase')}</Button></div>
        : <button type="button" className={o.reveal} onClick={() => setRevealed(true)}><span className={o.revealIcon}><Eye size={18} /></span><strong>{t('extension.copy.revealPhrase')}</strong><small>{t('extension.copy.revealHint')}</small></button>}
    </div>
    <div className={o.warning}><ShieldAlert size={16} aria-hidden="true" /><p>{t('extension.copy.phraseWarningLost')}</p>
      <HelpTip label={t('extension.copy.phraseSafety')} content={`${t('extension.copy.phraseWarningWallet')}\n${t('extension.copy.phraseWarningNeverAsk')}`} className={o.help} />
    </div>
  </Step>;
}

/** First BIP39 word with this prefix; the list is sorted, so completion is stable. */
function completion(value: string) {
  const prefix = value.trim().toLowerCase();
  if (prefix.length < 2 || words.has(prefix)) return '';
  return ENGLISH_WORDS.find(word => word.startsWith(prefix))?.slice(prefix.length) ?? '';
}

/** False once no BIP39 word can start this way. */
const possible = (value: string) => { const prefix = value.trim().toLowerCase(); return !prefix || ENGLISH_WORDS.some(word => word.startsWith(prefix)); };

/**
 * Phrase cell with inline completion instead of a native suggestion list.
 * Tab, Enter or → accepts the grey suffix; space accepts and moves to the next cell.
 */
function WordInput({ number, value, invalid, onValue, onPaste, autoFocus, disabled, label }: { number: number; value: string; invalid?: boolean; onValue: (value: string) => void; onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void; autoFocus?: boolean; disabled?: boolean; label: string }) {
  const suffix = completion(value);
  const valid = words.has(value.trim().toLowerCase());
  function next(input: HTMLInputElement) {
    const cells = [...input.closest('[data-word-grid]')?.querySelectorAll('input') ?? []];
    cells[cells.indexOf(input) + 1]?.focus();
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const atEnd = input.selectionStart === input.value.length;
    if (event.key === ' ') { event.preventDefault(); if (suffix) onValue(value.trim().toLowerCase() + suffix); next(input); return; }
    if (!suffix || !atEnd) return;
    if (event.key === 'Tab' && !event.shiftKey) onValue(value.trim().toLowerCase() + suffix);
    else if (event.key === 'Enter' || event.key === 'ArrowRight') { event.preventDefault(); onValue(value.trim().toLowerCase() + suffix); }
  }
  return <label className={o.word} data-state={invalid ? 'invalid' : valid ? 'valid' : undefined}>
    <span className={o.wordNumber}>{number}</span>
    <span className={o.wordBox}>
      <input aria-label={label} aria-invalid={invalid || undefined} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" autoFocus={autoFocus} value={value} disabled={disabled} onPaste={onPaste} onKeyDown={keyDown} onChange={event => onValue(event.target.value.replace(/\s+/g, ''))} />
      {suffix && <span className={o.ghost} aria-hidden="true"><span>{value}</span>{suffix}</span>}
    </span>
  </label>;
}

/** Uniform pick from [0, n) using the platform CSPRNG. */
function pick(n: number) { const value = new Uint32Array(1); crypto.getRandomValues(value); return value[0]! % n; }

/** Two questions, up to four distinct candidates each. Decoys come from the same phrase, so only the order proves the backup. */
function quiz(phrase: string[]) {
  const distinct = new Set(phrase).size;
  const positions: number[] = [];
  while (positions.length < 2) { const position = pick(phrase.length); if (!positions.includes(position)) positions.push(position); }
  return positions.sort((a, b) => a - b).map(position => {
    const choices = [phrase[position]!];
    while (choices.length < Math.min(4, distinct)) { const word = phrase[pick(phrase.length)]!; if (!choices.includes(word)) choices.push(word); }
    for (let i = choices.length - 1; i > 0; i--) { const j = pick(i + 1); [choices[i], choices[j]] = [choices[j]!, choices[i]!]; }
    return { position, choices };
  });
}

function ConfirmPhrase({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const text = useText();
  const [questions] = useState(() => quiz(c.phrase));
  const [round, setRound] = useState(0);
  const [chosen, setChosen] = useState<string>();
  const [error, setError] = useState<TextValue>('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; clearTimeout(timer.current); };
  }, []);
  const finished = round >= questions.length;
  const question = questions[Math.min(round, questions.length - 1)]!;
  async function create() {
    if (!active.current || !c.ownsScreen() || c.authBusy) return;
    setError(''); try { await c.createAccount(); } catch (cause) { if (active.current && c.ownsScreen()) setError(failure(cause, 'common.error')); }
  }
  function choose(word: string) {
    if (!active.current || !c.ownsScreen() || chosen || finished) return;
    setChosen(word);
    if (word !== c.phrase[question.position]) { setError(uiMessage('extension.copy.phraseMismatch')); timer.current = setTimeout(() => { if (active.current && c.ownsScreen()) setChosen(undefined); }, 700); return; }
    setError('');
    timer.current = setTimeout(() => { if (!active.current || !c.ownsScreen()) return; setChosen(undefined); setRound(round + 1); if (round + 1 === questions.length) void create(); }, 420);
  }
  // Two right answers move on by themselves; a button only appears when that step failed.
  return <Step title={t('extension.copy.confirmPhraseTitle')} lead={t('extension.copy.confirmPhraseHint')} footer={finished && error ? <Button variant="primary" size="lg" loading={c.authBusy} loadingLabel={t('common.working')} onClick={() => void create()}>{t('common.retry')}</Button> : null}>
    <div className={o.quiz} key={finished ? 'done' : round}>
      <div className={o.quizHead}>
        <p className={o.quizQuestion}>{t('extension.dynamic.whichWord', { number: question.position + 1 })}</p>
        <span className={o.quizDots} aria-hidden="true">{questions.map((_, index) => <i key={index} data-done={index < round || undefined} data-current={index === round || undefined} />)}</span>
      </div>
      <div className={o.choices} role="group" aria-label={t('extension.dynamic.whichWord', { number: question.position + 1 })}>
        {question.choices.map((word, index) => {
          const state = finished && word === c.phrase[question.position] ? 'right' : chosen === word ? (word === c.phrase[question.position] ? 'right' : 'wrong') : undefined;
          return <button key={word} type="button" className={o.choice} data-state={state} disabled={finished || c.authBusy} autoFocus={index === 0} onClick={() => choose(word)}>{word}{state === 'right' && <Check size={14} strokeWidth={2.5} aria-hidden="true" />}</button>;
        })}
      </div>
    </div>
    {error && <p className={edge.error} role="alert">{text(error)}</p>}
  </Step>;
}

function RestorePhrase({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const text = useText();
  const [phrase, setPhrase] = useState<string[]>(() => Array(12).fill(''));
  const [error, setError] = useState<TextValue>('');
  const filled = phrase.filter(word => words.has(word.trim().toLowerCase())).length;
  const valid = filled === 12;
  function paste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text').trim().toLowerCase().split(/\s+/);
    if (pasted.length < 2) return;
    event.preventDefault(); setError('');
    setPhrase(old => old.map((word, n) => n >= index && n - index < pasted.length ? pasted[n - index]! : word));
  }
  async function submit() {
    if (!valid || c.authBusy) return;
    setError(''); try { await c.restoreAccount(phrase); }
    catch (cause) { if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ACCOUNT_NOT_FOUND') setPhrase(Array(12).fill('')); setError(failure(cause, 'common.error')); }
  }
  return <Step title={t('extension.copy.restoreTitle')} lead={t('extension.copy.restoreHint')} help={{ label: t('extension.copy.restorePasteHint'), content: t('extension.copy.restorePasteHint') }} onSubmit={() => void submit()} footer={<Button type="submit" variant="primary" size="lg" loading={c.authBusy} loadingLabel={t('extension.copy.signingIn')} disabled={!valid}>{t('extension.copy.signIn')}</Button>}>
    <div className={o.sheet}>
      <div className={o.sheetHead}>
        <span className={o.sheetCount} data-complete={valid || undefined}><b><Count value={filled} /></b> / 12</span>
        {phrase.some(Boolean) && !c.authBusy && <Button size="sm" variant="quiet" className={o.sheetClear} onClick={() => { setPhrase(Array(12).fill('')); setError(''); }}>{t('extension.copy.clearPhrase')}</Button>}
      </div>
      <div className={o.wordGrid} data-word-grid>{phrase.map((word, index) => <WordInput key={index} number={index + 1} label={t('extension.dynamic.wordNumber', { number: index + 1 })} invalid={!possible(word)} autoFocus={index === 0} value={word} disabled={c.authBusy} onPaste={event => paste(index, event)} onValue={value => { setPhrase(old => old.map((item, n) => n === index ? value : item)); setError(''); }} />)}</div>
    </div>
    {error && <p className={edge.error} role="alert">{text(error)}</p>}
  </Step>;
}

/** Six visible digits, entered once; the person sees exactly what they chose. */
function PasswordSetup({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const text = useText();
  const [pin, setPin] = useState('');
  const [error, setError] = useTextState();
  async function submit() {
    if (pin.length < PIN_LENGTH || c.authBusy) return;
    setError(''); try { await c.setPassword(pin); } catch (cause) { setError(failure(cause, 'common.error')); }
  }
  return <Step title={t('extension.copy.passwordTitle')} lead={t('extension.copy.passwordHint')} help={{ label: t('extension.copy.passwordHelpLabel'), content: t('extension.copy.passwordHelp') }} onSubmit={() => void submit()}
    footer={<Button type="submit" variant="primary" size="lg" loading={c.authBusy} loadingLabel={t('common.working')} disabled={pin.length < PIN_LENGTH}>{t(c.flow === 'create' ? 'extension.copy.createAccount' : 'extension.copy.signIn')}</Button>}>
    <div className={o.pinBlock}>
      <PinInput outlined reveal aria-label={t('extension.copy.password')} aria-invalid={Boolean(error)} aria-describedby={error ? 'pin-error' : undefined} autoComplete="off" autoFocus value={pin} disabled={c.authBusy} onValueChange={value => { setPin(value); setError(''); }} />
      {error && <p id="pin-error" className={edge.error} role="alert">{text(error)}</p>}
    </div>
  </Step>;
}

function Nickname({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const text = useText();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TextValue>('');
  const invalid = characterLength(name.trim()) > NICKNAME_LENGTH ? t('extension.copy.nicknameLimit') : '';
  async function submit() {
    if (busy || invalid || !name.trim()) return;
    setBusy(true); setError('');
    try {
      if (c.live) await c.live.command('profile', { name: name.trim() });
      else c.setPeople(old => old.map(person => person.id === c.data.self ? { ...person, name: name.trim() } : person));
      if (c.data.pendingInvite) c.openInvitation();
      else c.go('chat');
    } catch (cause) { setError(failure(cause, 'extension.copy.profileSaveFailed')); }
    finally { setBusy(false); }
  }
  return <Step title={t('extension.copy.yourNameTitle')} lead={t('extension.copy.nicknameLead')} onSubmit={() => void submit()} footer={<Button type="submit" variant="primary" size="lg" loading={busy} loadingLabel={t('common.working')} disabled={!name.trim() || Boolean(invalid)}>{t('extension.copy.finishSetup')}</Button>}>
    <Field label={t('extension.copy.nickname')} error={invalid}>{props => <Input {...props} required autoFocus placeholder={t('extension.copy.yourName')} value={name} disabled={busy} onChange={event => { setName(event.target.value); setError(''); }} />}</Field>
    {error && <p className={edge.error} role="alert">{text(error)}</p>}
  </Step>;
}

export function Onboarding({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const back = !c.working && (c.screen === 'new-account' || c.screen === 'restore' || c.screen === 'confirm-phrase');
  const shell = useRef<HTMLElement>(null);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (c.working) { wasRunning.current = true; return; }
    if (wasRunning.current) { wasRunning.current = false; shell.current?.querySelector<HTMLElement>('[data-step-heading]')?.focus({ preventScroll: true }); }
  }, [c.working]);
  return <section ref={shell} className={o.shell} data-screen={c.working ? 'working' : c.screen} aria-label={t('extension.copy.onboardingSteps')}>
    <header className={o.header}>
      {back ? <Action label={t('common.back')} onClick={() => c.go(c.screen === 'confirm-phrase' ? 'new-account' : 'welcome')}><ArrowLeft /></Action> : <Brand />}
      {c.live && <LanguageSetting compact />}
    </header>
    <Steps c={c} />
    {c.working && <div className={o.body}><Working flow={c.flow} /></div>}
    {/* The step stays mounted underneath so a failed request returns to the same answers and error. */}
    <div className={o.body} key={c.screen} hidden={c.working} data-palside-panel-scroll>
      {c.screen === 'welcome' ? <Welcome c={c} />
        : c.screen === 'new-account' ? <NewPhrase c={c} />
        : c.screen === 'confirm-phrase' ? <ConfirmPhrase key={`${c.flow}:${c.phrase.join(' ')}`} c={c} />
        : c.screen === 'restore' ? <RestorePhrase c={c} />
        : c.screen === 'password' ? <PasswordSetup c={c} />
        : <Nickname c={c} />}
    </div>
  </section>;
}
