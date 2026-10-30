'use client';
import { chatTime, errorMessage, localeOrEnglish, message as uiMessage } from '@palside/i18n';
import { useLocale, useTranslations } from 'use-intl';
import { Count, CountText } from '../ui/motion-details';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Crosshair, Eye, EyeOff, MoreHorizontal, PenLine, Quote, Trash2, X } from 'lucide-react';
import { Tooltip } from '@palside/ui/tooltip';
import { locateFeedback } from './locate-feedback';
import { characterLength } from '../../../domain/chat/model';
import { personFor } from '../../../domain/account/model';
import { STICKY_MAX, pageScopeUrl, viewAsset, visibleStickies as teamStickies, type AssetKey, type Sticky, type StickyScope } from '../../../domain/annotations/social';
import { captureSocialUi, navigateWithReturn, setSocialUi, useSocialUi } from './social-state';
import { relativeTime } from '../assets/asset-discussion';
import { tabView } from '../rooms/rooms';
import { withTargetAccess } from '../settings/access';
import { Sheet } from '@palside/ui/sheet';
import { Button, IconButton } from '@palside/ui/button';
import { Menu, MenuTrigger, MenuContent, MenuItem } from '@palside/ui/menu';
import { SiteLogo } from '../assets/site-logo';
import { siteForUrl } from '../settings/site-catalog';
import { Action, PersonAvatar, Token } from '../ui/primitives';
import type { PalsideController } from '../app/use-palside';
import { useText } from '../ui/text';
import s from './records.module.css';

export function visibleStickies(c: PalsideController, scope: AssetKey | StickyScope): Sticky[] {
  const items = c.live?.state.items;
  return items ? teamStickies(items, c.current, scope, c.now) : [];
}
export function shownStickyCount(c: PalsideController, scope: AssetKey | StickyScope) {
  const hidden = c.live?.state.preferences.hiddenStickies ?? [];
  return visibleStickies(c, scope).filter(item => !hidden.includes(item.id)).length;
}
function hostOf(url?: string) { try { return url ? new URL(url).hostname.replace(/^www\./, '') : undefined; } catch { return; } }
const looksLikeAddress = (name: string) => /^0x[\da-f.…]+$/i.test(name.trim());

/** The note's time in the 36px column: the clock today, month/day this year, the year before that. The full time is in its title. */
export function clock(at: number, now: number, locale: string) {
  const day = new Date(at), today = new Date(now);
  if (day.toDateString() === today.toDateString()) return chatTime(at, localeOrEnglish(locale), now);
  return day.getFullYear() === today.getFullYear() ? `${day.getMonth() + 1}/${day.getDate()}` : String(day.getFullYear());
}

/** Notes for one page or token, newest first; hidden ones fold away at the end. Saved records stay readable even when their text can no longer be found. */
function NoteList({ c, asset, url, focus }: { c: PalsideController; asset?: AssetKey; url?: string; focus?: string }) {
  const t = useTranslations();
  const all = visibleStickies(c, url ? { url } : { asset });
  const hiddenIds = c.live?.state.preferences.hiddenStickies ?? [];
  const shown = all.filter(item => !hiddenIds.includes(item.id)).sort((a, b) => b.timestamp - a.timestamp);
  const hidden = all.filter(item => hiddenIds.includes(item.id));
  const [unfolded, setUnfolded] = useState(() => Boolean(focus && hiddenIds.includes(focus)));
  return <div className={s.notes}>
    {shown.length ? <ul className={s.recList}>{shown.map(item => <Note key={item.id} c={c} sticky={item} focused={item.id === focus} />)}</ul> : <p className={s.empty}>{t('extension.sticky.empty')}</p>}
    {hidden.length > 0 && <div className={s.fold}>
      <button type="button" aria-expanded={unfolded} onClick={() => setUnfolded(value => !value)}><EyeOff size={14} /><span><CountText text={t('extension.sticky.hidden', { count: hidden.length })} value={hidden.length} /></span><ChevronDown size={14} /></button>
      {unfolded && <ul className={s.recList}>{hidden.map(item => <Note key={item.id} c={c} sticky={item} hidden focused={item.id === focus} />)}</ul>}
    </div>}
  </div>;
}

function Editor({ value, onChange, onSubmit, onCancel, busy, placeholder, submit, allowEmpty = false, compact = false }: { value: string; onChange: (value: string) => void; onSubmit: () => void; onCancel?: () => void; busy: boolean; placeholder: string; submit: string; allowEmpty?: boolean; compact?: boolean }) {
  const t = useTranslations();
  const input = useRef<HTMLTextAreaElement>(null);
  const length = characterLength(value.trim());
  const valid = (allowEmpty || length > 0) && length <= STICKY_MAX;
  useLayoutEffect(() => { const el = input.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }, [value]);
  const editing = Boolean(onCancel);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  function keys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (valid && !busy) onSubmit(); }
    if (event.key === 'Escape' && !busy && (onCancel || value)) { event.preventDefault(); event.stopPropagation(); if (onCancel) onCancel(); else onChange(''); }
  }
  return <div className={s.editor} data-compact={compact || undefined}>
    <textarea ref={input} rows={1} value={value} placeholder={placeholder} aria-label={placeholder} disabled={busy} onChange={event => onChange(event.target.value)} onKeyDown={keys} />
    {(value.trim() || onCancel) && <div className={s.editorBar}>
      {length > STICKY_MAX - 30 && <small className={s.counter} data-over={length > STICKY_MAX || undefined}><Count value={length} />/{STICKY_MAX}</small>}
      {onCancel && <Button size="sm" variant="quiet" className={s.editorAction} disabled={busy} onClick={onCancel}>{t('common.cancel')}</Button>}
      <Button size="sm" variant="primary" className={s.editorAction} disabled={!valid || busy} aria-busy={busy} onClick={onSubmit}>{submit}</Button>
    </div>}
  </div>;
}

/** 给整个代币写一条: one line until you type. A retry after a failure reuses its operation so it is never saved twice. */
export function Writer({ c, asset, className }: { c: PalsideController; asset: AssetKey; className?: string }) {
  const t = useTranslations(); const text = useText();
  const [value, setValue] = useState(''); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const operation = useRef<{ text: string; id: string } | undefined>(undefined); const [failure, setFailure] = useState('');
  async function submit() {
    if (!c.live || lock.current) return;
    const body = value.trim(); if (!body || characterLength(body) > STICKY_MAX) return;
    if (operation.current?.text !== body) operation.current = { text: body, id: crypto.randomUUID() };
    lock.current = true; setBusy(true); setFailure('');
    try { await c.live.command('team-event', { accountId: c.data.self, teamId: c.current, kind: 'sticky', asset, text: body, operationId: operation.current.id }); setValue(''); operation.current = undefined; }
    catch (error) { setFailure(text(errorMessage(error))); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className={className ? `${s.writer} ${className}` : s.writer}><Editor compact value={value} onChange={setValue} onSubmit={() => void submit()} busy={busy} placeholder={t('extension.sticky.assetNote')} submit={t('extension.copy.save')} />{failure && <p className={s.failure} role="alert">{failure}</p>}</div>;
}

/** One note: who and when, what they wrote, and the words it is pinned to — tapping those words finds them on the page. */
function Note({ c, sticky, hidden = false, focused = false }: { c: PalsideController; sticky: Sticky; hidden?: boolean; focused?: boolean }) {
  const t = useTranslations(); const text = useText(); const locale = useLocale(); const live = c.live; const page = live?.page;
  const request = useSocialUi().stickies;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const row = useRef<HTMLLIElement>(null); const mine = sticky.author === c.data.self;
  const person = personFor(c.people, sticky.author, t('common.member'));
  const quote = sticky.target?.kind === 'quote' ? sticky.target.exact : sticky.caption?.replace(/^“|”$/g, '');
  const [editing, setEditing] = useState(false); const [value, setValue] = useState(sticky.text); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [base, setBase] = useState(sticky.revision ?? sticky.id); const [failure, setFailure] = useState('');
  const operation = useRef<{ content: string; id: string } | undefined>(undefined);
  useEffect(() => { if (focused) { row.current?.scrollIntoView({ block: 'nearest' }); row.current?.focus({ preventScroll: true }); } }, [focused]);
  const missing = Boolean(sticky.target && pageScopeUrl(page?.url) === pageScopeUrl(sticky.url) && page?.missingStickies?.includes(sticky.id));
  const site = hostOf(sticky.url) ?? sticky.site;
  const stale = base !== (sticky.revision ?? sticky.id);
  function edit() { setValue(sticky.text); setBase(sticky.revision ?? sticky.id); setFailure(''); operation.current = undefined; setEditing(true); }
  function hide(next: boolean) {
    const current = live?.state.preferences.hiddenStickies ?? [];
    void c.run('preferences', { accountId: c.data.self, hiddenStickies: next ? [...new Set([...current, sticky.id])] : current.filter(id => id !== sticky.id) });
  }
  function remove() {
    c.setConfirmation({ title: uiMessage('extension.sticky.deleteTitle'), description: uiMessage('extension.sticky.deleteDescription'), action: uiMessage('extension.sticky.delete'), danger: true, confirm: () => live?.command('team-event-remove', { accountId: c.data.self, teamId: c.current, kind: 'sticky', id: sticky.id, baseRevision: sticky.revision ?? sticky.id }).then(() => {}) });
  }
  async function run(work: () => Promise<unknown>) {
    if (!live || lock.current) return;
    lock.current = true; setBusy(true); setFailure('');
    try { await work(); } catch (error) { setFailure(text(errorMessage(error))); } finally { lock.current = false; setBusy(false); }
  }
  const find = () => run(async () => { const result = await navigateWithReturn(live!, sticky.url ?? '', () => live!.command('locate-sticky', { teamId: c.current, stickyId: sticky.id })); const key = locateFeedback[result]; if (key) setFailure(t(key)); });
  const quoteToChat = () => {
    const session = captureSocialUi();
    return run(async () => {
      await live!.command('quote-sticky', { accountId: c.data.self, teamId: c.current, stickyId: sticky.id });
      if (!mounted.current || !c.ownsScreen() || !session.current() || session.snapshot()?.stickies !== request) return;
      session.set({ stickies: undefined }); c.go('chat');
    });
  };
  const save = () => run(async () => {
    const body = value.trim();
    if ((!sticky.target && !body) || characterLength(body) > STICKY_MAX) return;
    const content = JSON.stringify([body, base]);
    if (operation.current?.content !== content) operation.current = { content, id: crypto.randomUUID() };
    await live!.command('team-event', { accountId: c.data.self, teamId: c.current, kind: 'sticky', asset: sticky.asset, text: body, edits: sticky.id, baseRevision: base, operationId: operation.current.id });
    setEditing(false); operation.current = undefined;
  });
  const tools = !editing && <span className={s.recTools}>
    {sticky.target && c.canWrite && <Tooltip content={t('extension.sticky.quote')}><IconButton size="xs" variant="quiet" label={t('extension.sticky.quote')} disabled={busy} onClick={() => void quoteToChat()}><Quote size={14} style={{ width: 18, height: 18 }} /></IconButton></Tooltip>}
    {mine && c.canWrite
      ? <Menu boundarySelector="[data-palside-app]" align="end">
          <MenuTrigger asChild><IconButton label={t('extension.web.more')} size="xs" variant="quiet"><MoreHorizontal size={15} style={{ width: 18, height: 18 }} /></IconButton></MenuTrigger>
          <MenuContent aria-label={t('extension.web.more')} className={s.menu}>
            <MenuItem className={s.menuItem} icon={<PenLine size={16} />} onClick={edit}>{sticky.text ? t('extension.copy.edit') : t('extension.sticky.addComment')}</MenuItem>
            <MenuItem className={s.menuItem} icon={<Trash2 size={16} />} tone="danger" onClick={remove}>{t('extension.sticky.delete')}</MenuItem>
          </MenuContent>
        </Menu>
      : <Tooltip content={hidden ? t('extension.sticky.show') : t('extension.sticky.hide')}><IconButton size="xs" variant="quiet" label={hidden ? t('extension.sticky.show') : t('extension.sticky.hide')} onClick={() => hide(!hidden)}>{hidden ? <Eye size={14} style={{ width: 18, height: 18 }} /> : <EyeOff size={14} style={{ width: 18, height: 18 }} />}</IconButton></Tooltip>}
  </span>;
  return <li ref={row} className={s.recItem} tabIndex={focused ? -1 : undefined} data-focused={focused || undefined} data-hidden={hidden || undefined} data-editing={editing || undefined}>
    <div className={s.rec}>
      <time dateTime={new Date(sticky.timestamp).toISOString()} title={relativeTime(sticky.timestamp, locale, c.now)}>{clock(sticky.timestamp, c.now, locale)}</time>
      <PersonAvatar person={person} size="xs" /><b>{mine ? t('extension.page.you') : person.name}</b>
      <div className={s.recText}>
        {sticky.conflicted && !(editing && stale) && <span className={s.failure} role="status">{t('extension.sticky.conflict')}</span>}
        {editing && stale && <span className={s.conflict}><span role="status">{t('extension.runtime.annotationChanged')}</span><Button size="sm" variant="quiet" className={s.editorAction} disabled={busy} onClick={() => { setValue(sticky.text); setBase(sticky.revision ?? sticky.id); setFailure(''); operation.current = undefined; }}>{t('extension.sticky.loadLatest')}</Button></span>}
        {editing ? <Editor value={value} onChange={setValue} onSubmit={() => void save()} onCancel={() => { setEditing(false); setFailure(''); }} busy={busy} placeholder={t('extension.sticky.placeholder')} submit={t('extension.copy.save')} allowEmpty={Boolean(sticky.target)} />
          : sticky.text && <span>{sticky.text}{sticky.editedAt && <small className={s.edited}>{t('extension.copy.edited')}</small>}</span>}
        {quote && !editing && <Tooltip content={site ? `${t('extension.sticky.find')} · ${site}` : t('extension.sticky.find')}>
          <button type="button" className={s.anchor} aria-label={`${t('extension.sticky.find')}: ${quote}`} data-missing={missing || undefined} disabled={busy || !sticky.target} onClick={() => { const session = captureSocialUi(); withTargetAccess(c, sticky.url ?? '', () => { if (session.current() && mounted.current && c.ownsScreen()) void find(); }); }}>
            <span>{quote}</span>{sticky.target && <Crosshair size={12} aria-hidden="true" />}
          </button>
        </Tooltip>}
        {missing && !failure && <small className={s.note}>{t('extension.composer.refMissing')}</small>}
        {failure && <small className={s.failure} role="alert">{failure}</small>}
      </div>
    </div>
    {tools}
  </li>;
}

/** 便利贴 of one page: the page it belongs to in the title line (never a bare address), then the list. */
export function NoteSheet({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const request = useSocialUi().stickies; const asset = request?.asset; const url = request?.url;
  const page = c.live?.page;
  const view = (asset ? c.data.views.find(item => viewAsset(item) === asset) : undefined) ?? (url ? c.data.views.find(item => pageScopeUrl(item.url) === pageScopeUrl(url)) : undefined) ?? (url && pageScopeUrl(url) === pageScopeUrl(page?.url) ? tabView(page, asset) : undefined);
  const site = siteForUrl(url ?? view?.url ?? '', c.sites);
  const name = view && !looksLikeAddress(view.name) ? view.name : site?.name ?? hostOf(url ?? view?.url) ?? '';
  const count = request ? shownStickyCount(c, url ? { url } : { asset }) : 0;
  const close = () => setSocialUi({ stickies: undefined });
  return <Sheet open={Boolean(request && c.live)} onOpenChange={open => { if (!open) close(); }} aria-labelledby="note-sheet-title" boundarySelector="[data-palside-app]" className={s.sheet}>
    {request && <>
      <header className={s.sheetHead}>
        {view ? <Token view={view} size="sm" /> : site && <SiteLogo site={site} size="xs" />}
        <h2 id="note-sheet-title"><b>{t('extension.web.notesOn', { name })}</b>{count > 0 && <small><Count value={count} /></small>}</h2>
        <Action label={t('common.close')} onClick={close}><X size={16} /></Action>
      </header>
      <div className={s.sheetScroll}><NoteList key={`${c.data.self}:${c.current}:${url ?? asset}`} c={c} asset={asset} url={url} focus={request.focus} /></div>
    </>}
  </Sheet>;
}
