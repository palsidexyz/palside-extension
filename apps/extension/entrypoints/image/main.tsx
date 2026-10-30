import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { flushSync } from 'react-dom';
import { IntlProvider, useTranslations } from 'use-intl';
import { browser } from 'wxt/browser';
import { messagesFor, translator, errorMessage, type TextValue } from '@palside/i18n';
import { Button } from '@palside/ui/button';
import { ImageEditor } from '../../src/features/palside/media/image-editor';
import { useAppearance } from '../../src/features/palside/settings/appearance';
import { useText } from '../../src/features/palside/ui/text';
import { command } from '../../src/runtime/transport/bridge';
import { readLanguage, type LanguageState } from '../../src/runtime/transport/language';
import type { ImageSessionSnapshot } from '../../src/runtime/media/image-sessions';
import type { ImageDocumentSnapshot } from '../../src/domain/images/image-document';
import '@palside/design/fonts.css';
import '../../src/styles.css';

function ImageWindow() {
  const [language, setLanguage] = useState<LanguageState>();
  const appearance = useAppearance();
  useEffect(() => {
    let active = true;
    const refresh = () => { void readLanguage(browser).then(value => { if (active) { setLanguage(value); document.documentElement.lang = value.locale; } }); };
    refresh(); browser.storage.onChanged.addListener(refresh);
    return () => { active = false; browser.storage.onChanged.removeListener(refresh); };
  }, []);
  const locale = language?.locale ?? 'en';
  const fallback = useCallback(() => translator(locale)('common.error'), [locale]);
  return <main data-palside-app data-appearance={appearance} style={{ height: '100%', background: 'var(--ui-canvas)', color: 'var(--ui-text-primary)' }}>
    {language && <IntlProvider locale={locale} messages={messagesFor(locale)} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} getMessageFallback={fallback}><Session /></IntlProvider>}
  </main>;
}
function Session() {
  const t = useTranslations(); const text = useText();
  const [session, setSession] = useState<ImageSessionSnapshot>();
  const current = useRef<ImageSessionSnapshot | undefined>(undefined);
  const [failure, setFailure] = useState<TextValue>(() => new URL(location.href).searchParams.get('session') ? '' : { key: 'extension.image.sessionEnded' });
  const queue = useRef(Promise.resolve());
  const pending = useRef<ImageDocumentSnapshot | undefined>(undefined);
  const documentRef = useRef<(() => ImageDocumentSnapshot | undefined) | undefined>(undefined);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const epoch = useRef(0);
  useEffect(() => {
    const started = ++epoch.current;
    const id = new URL(location.href).searchParams.get('session');
    if (!id) return;
    const clear = () => {
      epoch.current++; current.current = undefined; pending.current = undefined; documentRef.current = undefined;
      queue.current = Promise.resolve();
      for (const canvas of document.querySelectorAll('canvas')) { canvas.width = 0; canvas.height = 0; }
      for (const image of document.querySelectorAll('img')) image.removeAttribute('src');
    };
    const revoke = () => {
      if (epoch.current !== started) return;
      clear();
      flushSync(() => { setSession(undefined); setFailure({ key: 'extension.image.sessionEnded' }); });
    };
    const listener: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message, sender, respond) => {
      if (sender.id !== browser.runtime.id || sender.tab || sender.url && sender.url !== browser.runtime.getURL('/background.js') || message?.id !== id) return;
      if (message.type === 'palside/image-revoke') { revoke(); respond({ ok: true }); return; }
      if (message.type !== 'palside/image-flush' || epoch.current !== started) return;
      void flushRef.current().then(() => respond({ ok: epoch.current === started }), () => respond({ ok: false }));
      return true;
    };
    browser.runtime.onMessage.addListener(listener);
    let port: ReturnType<typeof browser.runtime.connect> | undefined;
    try {
      port = browser.runtime.connect({ name: 'palside/image' });
      port.onDisconnect.addListener(revoke);
      port.onMessage.addListener(message => { if (message.type === 'revoke') revoke(); });
      void command('image-session-read', { id }).then(value => {
        if (epoch.current !== started) return;
        current.current = value; setSession(value);
      }).catch(revoke);
    } catch { revoke(); }
    window.addEventListener('pagehide', revoke);
    return () => {
      clear(); window.removeEventListener('pagehide', revoke); browser.runtime.onMessage.removeListener(listener);
      port?.onDisconnect.removeListener(revoke); port?.disconnect();
    };
  }, []);
  function enqueue(document: ImageDocumentSnapshot) {
    if (!current.current) return;
    const started = epoch.current;
    pending.current = document;
    queue.current = queue.current.catch(() => {}).then(async () => {
      const value = pending.current; const session = current.current;
      if (!value || !session || epoch.current !== started) return;
      const next = await command('image-session-update', { id: session.id, expectedRevision: session.revision, document: value });
      if (epoch.current !== started) return;
      current.current = next;
      if (pending.current === value) pending.current = undefined;
      setFailure('');
    });
    void queue.current.catch(error => { if (epoch.current === started) setFailure(errorMessage(error)); });
  }
  async function flush() {
    documentRef.current?.();
    await queue.current.catch(() => {});
    if (pending.current) { enqueue(pending.current); await queue.current; }
  }
  useEffect(() => { flushRef.current = flush; });
  async function save(src: string) {
    await flush();
    const value = current.current; if (!value) throw new Error(t('extension.image.sessionEnded'));
    await command('image-session-save', { id: value.id, expectedRevision: value.revision, src });
  }
  async function close() {
    const started = epoch.current;
    try { await flush(); if (epoch.current === started) window.close(); }
    catch (error) { if (epoch.current === started) setFailure(errorMessage(error)); }
  }
  if (!session || session.status !== 'open') return <div role="status" style={{ padding: 24 }}><p>{text(failure) || (session ? t('extension.image.sessionEnded') : t('common.loading'))}</p><Button size="sm" onClick={() => window.close()}>{t('common.close')}</Button></div>;
  return <>
    <ImageEditor standalone documentRef={documentRef} src={session.source.src} name={session.source.name} mode={session.mode} snapshot={session.document as ImageDocumentSnapshot | undefined} onDocumentChange={session.mode === 'edit' ? enqueue : undefined} onSave={save} onClose={() => void close()} />
    {failure && <p role="alert" style={{ position: 'fixed', bottom: 120, left: 16, right: 16, padding: 12, background: 'var(--ui-canvas)', color: 'var(--ui-danger)', zIndex: 1 }}>{text(failure)}</p>}
  </>;
}
const root = document.getElementById('root');
if (!root) throw new Error('Palside root element is missing');
ReactDOM.createRoot(root).render(<React.StrictMode><ImageWindow /></React.StrictMode>);
