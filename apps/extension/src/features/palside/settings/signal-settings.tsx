'use client';
import { Button } from '@palside/ui/button';
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslations } from 'use-intl';
import { errorMessage } from '@palside/i18n';
import { Tooltip } from '@palside/ui/tooltip';
import { defaultSignalSettings, defaultWheel, isEmote, signalEmotes, signalKinds, signalModifiers, wheelIcon, WHEEL_SLOTS, type SignalModifier, type SignalSettings, type WheelEntry } from '../../../runtime/annotations/signals';
import { Range, Seg, Sub, SubSwitch, Tabs } from '../ui/sub-rows';
import type { PalsideController } from '../app/use-palside';
import s from './signal-settings.module.css';

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const keyNames: Record<SignalModifier, string> = mac ? { Control: '⌃ Control', Alt: '⌥ Option', Shift: '⇧ Shift' } : { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
const keySymbols: Record<SignalModifier, string> = mac ? { Control: '⌃', Alt: '⌥', Shift: '⇧' } : { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
export const signalKeyName = (key: readonly SignalModifier[]) => key.map(modifier => keyNames[modifier]).join(' + ');
/** A wheel entry's still, as the page wheel draws it. */
export function WheelArt({ entry, style }: { entry: WheelEntry; style?: CSSProperties }) {
  return <img src={`/signals/${wheelIcon(entry)}`} alt="" draggable={false} style={style} />;
}

/** The shortcut as keycaps. */
export function Keys({ value }: { value: readonly SignalModifier[] }) {
  return <KeyCaps keys={value.map(modifier => keyNames[modifier])} />;
}

/** Any key combination as keycaps, one per key. */
export function KeyCaps({ keys }: { keys: readonly string[] }) {
  return <span className={s.keys}>{keys.map((key, index) => <kbd key={index}>{key}</kbd>)}</span>;
}

/** 信号's settings: the wheel itself first — what each slot holds and the shortcut that opens it — then sizes and sound as secondary rows. Saved by the background for every page. */
export function SignalOptions({ c }: { c: PalsideController }) {
  return <AccountSignalOptions key={c.live ? c.live.state.account?.id : c.data.self} c={c} />;
}

function AccountSignalOptions({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const [settings, setSettings] = useState<SignalSettings>(defaultSignalSettings);
  const [ready, setReady] = useState(!c.live);
  const [busy, setBusy] = useState(false);
  const changes = useRef<Promise<unknown>>(Promise.resolve());
  const revision = useRef(0);
  const generation = useRef(0);
  const command = c.live?.command;
  const accountId = c.live?.state.account?.id;
  const notice = useRef(c.setNotice);
  useLayoutEffect(() => { notice.current = c.setNotice; }, [c.setNotice]);
  useLayoutEffect(() => {
    const scope = ++generation.current;
    void command?.('signal-settings-get').then(value => { if (scope === generation.current) { setSettings(value); setReady(true); } }).catch(error => { if (scope === generation.current) notice.current(errorMessage(error)); });
    return () => { generation.current = scope + 1; };
  }, [command]);
  const actual = c.live?.page?.signalSettings;
  const [observed, setObserved] = useState(actual);
  if (actual !== observed) { setObserved(actual); if (actual && !busy) setSettings(actual); }
  function save(patch: Partial<SignalSettings>) {
    setSettings(old => ({ ...old, ...patch }));
    if (!command || !accountId) return;
    setBusy(true);
    const request = ++revision.current;
    const scope = generation.current;
    const active = () => scope === generation.current;
    const latest = () => active() && request === revision.current;
    changes.current = changes.current.catch(() => {}).then(async () => {
      if (!active()) return;
      try {
        const saved = await command('signal-settings', { settings: patch, expectedAccountId: accountId });
        if (latest() && saved) setSettings(saved);
      } catch (error) {
        if (!active()) return;
        notice.current(errorMessage(error));
        if (latest()) {
          try { const saved = await command('signal-settings-get'); if (latest()) setSettings(saved); } catch { /* Keep the last visible choice until reconnect. */ }
        }
      }
    }).finally(() => { if (latest()) setBusy(false); });
  }
  const sizes: ['sm' | 'md' | 'lg', string][] = [['sm', t('extension.center.small')], ['md', t('extension.center.medium')], ['lg', t('extension.center.large')]];
  return <div className={s.root} inert={!ready} aria-busy={!ready || busy || undefined}>
    <WheelEditor value={settings.wheel} keys={settings.key} onChange={wheel => save({ wheel })} onKey={key => save({ key })} />
    <div className={s.rows}>
      <Sub label={t('extension.signal.size')}><Seg label={t('extension.signal.size')} value={settings.size} options={sizes} onChange={size => save({ size })} /></Sub>
      <Sub label={t('extension.signal.emoteSize')}><Seg label={t('extension.signal.emoteSize')} value={settings.emoteSize} options={sizes} onChange={emoteSize => save({ emoteSize })} /></Sub>
      <Sub label={t('extension.signal.wheelSize')}><Seg label={t('extension.signal.wheelSize')} value={settings.wheelSize} options={sizes} onChange={wheelSize => save({ wheelSize })} /></Sub>
      <SubSwitch label={t('extension.signal.sound')} checked={settings.sound} onChange={sound => save({ sound })} />
      {settings.sound && <Sub label={t('extension.signal.volume')}><Range label={t('extension.signal.volume')} min={0} max={100} value={settings.volume} onChange={volume => save({ volume })} /></Sub>}
    </div>
  </div>;
}

/**
 * The wheel as it opens on the page, then what can go on it. A slot is chosen on the wheel; tapping a signal or emote puts it
 * there and moves on to the next slot. One already on the wheel shows its slot number and trades places instead.
 */
function WheelEditor({ value, keys, onChange, onKey }: { value: WheelEntry[]; keys: SignalModifier[]; onChange: (wheel: WheelEntry[]) => void; onKey: (key: SignalModifier[]) => void }) {
  const t = useTranslations();
  const tabId = useId();
  const [slot, setSlot] = useState(0);
  const [tab, setTab] = useState<'signals' | 'emotes'>('signals');
  const [editing, setEditing] = useState(false);
  const slots = useRef<(HTMLButtonElement | null)[]>([]);
  const name = (entry: WheelEntry) => isEmote(entry) ? t(`extension.signal.emote_${entry}`) : t(`extension.signal.${entry}`);
  function put(entry: WheelEntry) {
    const next = [...value], from = next.indexOf(entry);
    if (from === slot) return;
    if (from >= 0) next[from] = next[slot]!;
    next[slot] = entry;
    onChange(next);
    if (from < 0) setSlot((slot + 1) % WHEEL_SLOTS);
  }
  function arrows(event: ReactKeyboardEvent) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (slot + step + WHEEL_SLOTS) % WHEEL_SLOTS;
    setSlot(next); slots.current[next]?.focus();
  }
  // The shortcut keeps at least one modifier, in the fixed ⌃ ⌥ ⇧ order.
  const toggleKey = (modifier: SignalModifier) => {
    const next = keys.includes(modifier) ? keys.filter(key => key !== modifier) : signalModifiers.filter(key => key === modifier || keys.includes(key));
    if (next.length) onKey(next);
  };
  const same = value.every((entry, index) => entry === defaultWheel[index]);
  const entries = tab === 'signals' ? signalKinds : signalEmotes;
  return <section className={s.editor} aria-label={t('extension.signal.wheel')}>
    <div className={s.stage}>
      <div className={s.wheel} role="radiogroup" aria-label={t('extension.signal.wheel')} onKeyDown={arrows}>
        {value.map((entry, index) => <Tooltip key={index} content={t('extension.signal.wheelSlot', { n: index + 1, name: name(entry) })}><button ref={node => { slots.current[index] = node; }} type="button" role="radio" className={s.slot} style={{ ['--a' as string]: `${index * 45}deg` }}
          aria-checked={slot === index} tabIndex={slot === index ? 0 : -1} aria-label={t('extension.signal.wheelSlot', { n: index + 1, name: name(entry) })} data-emote={isEmote(entry) || undefined} onClick={() => setSlot(index)}>
          <WheelArt entry={entry} />
        </button></Tooltip>)}
        <span className={s.hub} aria-hidden="true"><span className={s.hubKeys}>{keys.map(modifier => <kbd key={modifier}>{keySymbols[modifier]}</kbd>)}</span><small>{t('extension.signal.keyDrag')}</small></span>
      </div>
    </div>
    <div className={s.bar}>
      {editing
        ? <span className={s.keyChips} role="group" aria-label={t('extension.signal.key')}>{signalModifiers.map(modifier => <button key={modifier} type="button" aria-pressed={keys.includes(modifier)} onClick={() => toggleKey(modifier)}>{keyNames[modifier]}</button>)}</span>
        : <span className={s.barLabel}>{t('extension.signal.key')}<Keys value={keys} /></span>}
      <Button size="sm" variant="quiet" onClick={() => setEditing(on => !on)}>{t(editing ? 'extension.capture.done' : 'extension.signal.keyChange')}</Button>
    </div>
    <div className={s.bar}>
      <Tabs id={tabId} as="span" className={s.tabs} label={t('extension.signal.wheel')} value={tab} tabs={[[ 'signals', t('extension.web.signal') ], [ 'emotes', t('extension.signal.wheelEmotes') ]]} onChange={setTab} />
      <Button size="sm" variant="quiet" disabled={same} onClick={() => { onChange([...defaultWheel]); setSlot(0); }}>{t('extension.signal.wheelReset')}</Button>
    </div>
    <div className={s.palette} role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-tab-${tab}`} tabIndex={0}>{entries.map(entry => { const at = value.indexOf(entry); return <button key={entry} type="button" className={s.pick}
      aria-label={at >= 0 ? `${name(entry)} · ${t('extension.signal.wheelSlot', { n: at + 1, name: name(entry) })}` : name(entry)} aria-pressed={at === slot} data-on={at >= 0 || undefined} data-emote={isEmote(entry) || undefined} onClick={() => put(entry)}>
      <WheelArt entry={entry} /><span className={s.pickName}>{name(entry)}</span>{at >= 0 && <span className={s.slotNo} aria-hidden="true">{at + 1}</span>}
    </button>; })}</div>
  </section>;
}
