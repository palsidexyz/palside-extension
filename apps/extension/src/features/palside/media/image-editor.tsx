'use client';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'use-intl';
import { ArrowLeft, Maximize2, Minus, Plus, Scan } from 'lucide-react';
import { Button, IconButton } from '@palside/ui/button';
import { AlertDialog } from '@palside/ui/dialog';
import { errorMessage } from '@palside/i18n';
import { createImageWorkspace, type ImageWorkspaceState, type ImageWorkspaceLabels } from '../../../runtime/media/image-workspace';
import type { ImageDocumentSnapshot } from '../../../domain/images/image-document';
import type { ImageSessionSnapshot } from '../../../runtime/media/image-sessions';
import type { LivePort } from '../app/live-port';
import { useText } from '../ui/text';
import s from './image-editor.module.css';

type RemoteImage = ImageSessionSnapshot & { windowOpen?: boolean };
type Props = {
  src: string; name?: string; mode?: 'view' | 'edit'; teamId?: string;
  command?: LivePort['command']; standalone?: boolean; snapshot?: ImageDocumentSnapshot;
  onDocumentChange?: (snapshot: ImageDocumentSnapshot) => void;
  documentRef?: RefObject<(() => ImageDocumentSnapshot | undefined) | undefined>;
  onSave?: (src: string) => Promise<void> | void; onClose: () => void;
};
const initialState: ImageWorkspaceState = { ready: false, dirty: false, tool: 'pan', zoom: 1, undoReady: false, redoReady: false };

/** One image document survives chat updates, viewport changes and language changes. */
export function ImageEditor({ src, name, mode = 'edit', teamId, command, standalone = false, snapshot, onDocumentChange, documentRef, onSave, onClose }: Props) {
  const t = useTranslations(); const text = useText();
  const labels = useMemo(() => ({
    rectangle: t('extension.capture.rectangle'), arrow: t('extension.capture.arrow'), pen: t('extension.capture.pen'),
    text: t('extension.capture.text'), mosaic: t('extension.capture.mosaic'), undo: t('extension.capture.undo'),
    copy: t('extension.copy.copy'), cancel: t('extension.capture.cancel'), done: t('extension.capture.done'),
    copied: t('extension.copy.copied'), crop: t('extension.capture.crop'), redo: t('extension.capture.redo'),
    pan: t('extension.image.pan'),
  } satisfies ImageWorkspaceLabels), [t]);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null); const tools = useRef<HTMLDivElement>(null);
  const editor = useRef<ReturnType<typeof createImageWorkspace> | undefined>(undefined);
  const handlers = useRef({ onSave, onClose, onDocumentChange });
  const initialDocument = useRef(snapshot);
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [failure, setFailure] = useState('');
  const [remote, setRemote] = useState<RemoteImage>();
  const returnButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (remote) returnButton.current?.focus({ preventScroll: true }); }, [remote]);
  const [confirmClose, setConfirmClose] = useState(false);
  function requestClose() {
    if (busyRef.current || remote) return;
    if (!standalone && mode === 'edit' && state.dirty) setConfirmClose(true);
    else onClose();
  }
  const closeRequest = useRef(requestClose);
  useEffect(() => { closeRequest.current = requestClose; });
  useEffect(() => { handlers.current = { onSave, onClose, onDocumentChange }; }, [onSave, onClose, onDocumentChange]);
  useEffect(() => {
    const element = stage.current; if (!element) return;
    let active = true;
    const workspace = createImageWorkspace(element, message => {
      if (!active || message.type !== 'captured' || busyRef.current) return;
      busyRef.current = true; setBusy(true); setFailure('');
      Promise.resolve().then(() => handlers.current.onSave?.(message.src)).then(() => { if (active) handlers.current.onClose(); }).catch(error => {
        if (active) setFailure(text(errorMessage(error)));
      }).finally(() => { busyRef.current = false; if (active) setBusy(false); });
    }, src, labels, {
      toolbarMount: mode === 'edit' ? tools.current ?? undefined : undefined,
      snapshot: initialDocument.current,
      onStateChange: value => { if (active) setState(value); },
      onDocumentChange: value => handlers.current.onDocumentChange?.(value),
    });
    editor.current = workspace;
    if (documentRef) documentRef.current = () => workspace.getSnapshot();
    return () => { active = false; if (documentRef) documentRef.current = undefined; workspace.stop(); editor.current = undefined; };
    // The document is keyed by its source, not by translation or callback identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, mode]);
  useEffect(() => {
    editor.current?.updateLabels(labels);
  }, [src, mode, labels]);
  useEffect(() => {
    const element = dialog.current; if (!element || standalone) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const boundary = element.closest<HTMLElement>('[data-palside-app]');
    const size = () => { const rect = boundary?.getBoundingClientRect(); if (rect) Object.assign(element.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }); };
    const cancel = (event: Event) => { event.preventDefault(); closeRequest.current(); };
    element.addEventListener('cancel', cancel);
    size(); element.showModal();
    const observer = new ResizeObserver(size); if (boundary) observer.observe(boundary);
    window.addEventListener('resize', size);
    return () => { observer.disconnect(); window.removeEventListener('resize', size); element.removeEventListener('cancel', cancel); element.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [standalone]);
  useEffect(() => {
    if (!remote || !command) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await command('image-session-read', { id: remote.id });
        if (!active) return;
        setFailure('');
        if (next.status === 'saved') { handlers.current.onClose(); return; }
        if (next.windowOpen === false) {
          if (next.document) editor.current?.restoreState(next.document as ImageDocumentSnapshot);
          setRemote(undefined); return;
        }
      } catch (error) {
        if (!active) return;
        setFailure(text(errorMessage(error)));
        if (error && typeof error === 'object' && 'code' in error && error.code === 'IMAGE_SESSION_UNAVAILABLE') {
          setRemote(undefined); return;
        }
      }
      if (active) timer = setTimeout(() => void poll(), 750);
    };
    timer = setTimeout(() => void poll(), 750);
    return () => { active = false; clearTimeout(timer); };
  }, [remote, command, text]);
  async function openWindow() {
    if (!command || !teamId || busyRef.current) return;
    busyRef.current = true; setBusy(true); setFailure('');
    try {
      const document = editor.current?.getSnapshot();
      const result = await command('image-session-open', { mode, teamId, source: { src, name: name ?? '' }, document });
      setRemote(result);
    } catch (error) { setFailure(text(errorMessage(error))); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function returnToPanel() {
    if (!command || !remote || busyRef.current) return;
    busyRef.current = true; setBusy(true); setFailure('');
    try {
      const next = await command('image-session-return', { id: remote.id });
      if (next.status === 'saved') handlers.current.onClose();
      else if (next.document) editor.current?.restoreState(next.document as ImageDocumentSnapshot);
      setRemote(undefined);
    } catch (error) { setFailure(text(errorMessage(error))); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const blocked = busy || Boolean(remote);
  const content = <>
    <header className={s.header}>
      <IconButton size="sm" variant="quiet" label={standalone ? t('extension.image.returnPanel') : mode === 'edit' ? t('common.cancel') : t('common.back')} disabled={blocked} onClick={requestClose}><ArrowLeft /></IconButton>
      <h2>{t(mode === 'edit' ? 'extension.composer.editImage' : 'extension.image.view')}</h2>
      {command && !standalone && <IconButton size="sm" variant="quiet" label={t('extension.image.openWindow')} disabled={blocked || !state.ready} onClick={() => void openWindow()}><Maximize2 /></IconButton>}
      {mode === 'edit' && <Button size="sm" variant="primary" loading={busy} disabled={!state.ready || Boolean(remote)} onClick={() => editor.current?.complete()}>{t('extension.copy.save')}</Button>}
    </header>
    <div className={s.canvasArea}>
      <div ref={stage} className={s.stage} inert={blocked} aria-label={name || t('extension.image.view')} />
      {!state.ready && !state.error && <div className={s.status} role="status">{t('common.loading')}</div>}
      {remote && <div className={s.handoff}><span>{t('extension.image.inWindow')}</span><Button ref={returnButton} size="sm" onClick={() => void returnToPanel()} loading={busy}>{t('extension.image.returnPanel')}</Button></div>}
    </div>
    {(failure || state.error) && <p className={s.error} role="alert">{failure || t('extension.copy.imageReadFailed')}</p>}
    <footer className={s.footer} inert={blocked}>
      <div className={s.zoom}>
        <IconButton size="sm" variant="quiet" label={t('extension.image.zoomOut')} disabled={!state.ready} onClick={() => editor.current?.zoomOut()}><Minus /></IconButton>
        <span className={s.zoomValue}>{Math.round(state.zoom * 100)}%</span>
        <IconButton size="sm" variant="quiet" label={t('extension.image.zoomIn')} disabled={!state.ready} onClick={() => editor.current?.zoomIn()}><Plus /></IconButton>
        <IconButton size="sm" variant="quiet" label={t('extension.image.fit')} disabled={!state.ready} onClick={() => editor.current?.resetView()}><Scan /></IconButton>
      </div>
      {mode === 'edit' && <div ref={tools} className={s.tools} />}
    </footer>
  </>;
  return standalone ? <section className={s.workspace} aria-label={t('extension.image.view')}>{content}</section>
    : <><dialog ref={dialog} className={s.workspace} aria-label={t(mode === 'edit' ? 'extension.composer.editImage' : 'extension.image.view')} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && !confirmClose) { event.preventDefault(); event.stopPropagation(); requestClose(); } }}>{content}</dialog>
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose} title={t('extension.image.discardTitle')} description={t('extension.image.discardDescription')} confirmLabel={t('extension.image.discard')} cancelLabel={t('extension.image.keepEditing')} placement="bottom" boundarySelector="[data-palside-app]" tone="danger" onConfirm={onClose} />
    </>;
}
