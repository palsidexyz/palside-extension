import { failureText } from '@palside/i18n';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';

const DONE_HOLD_MS = 700;

export function useAccountFlow(state: PanelState, getActions: () => PanelActions): Pick<PanelActions, 'startCreate' | 'previewInvite' | 'createAccount' | 'restoreAccount' | 'setPassword'> {
  const { view: { authBusy, live, setNotice, data, phrase, flow, screen, ownsScreen }, setAuthBusy, mounted, setFlow, setPhrase, setScreen, setWorking } = state;
  const generation = useMemo(() => ({ phrase, flow }), [phrase, flow]);
  const activeGeneration = useRef<object | undefined>(undefined);
  useLayoutEffect(() => {
    activeGeneration.current = generation;
    return () => { activeGeneration.current = undefined; };
  }, [generation]);
async function identityStep(work: () => Promise<unknown>) {
    if (authBusy) return; setAuthBusy(true);
    try { await work(); } finally { if (mounted.current) setAuthBusy(false); }
  }
async function startCreate() {
    if (authBusy) return;
    activeGeneration.current = undefined;
    setFlow('create');
    await identityStep(async () => {
      try { const result = await live!.command('account-generate'); if (!mounted.current || !ownsScreen()) return; setPhrase(result.words); setScreen('new-account'); }
      catch (error) { if (mounted.current && ownsScreen()) setNotice(failureText(error)); }
    });
  }
async function previewInvite(url: string) {
    if (!live) return;
    const result = await live.command('invite-preview', { url });
    return result;
  }
// Deriving keys is local and instant; only password-set, which registers and connects, takes long enough to show.
  const createAccount = async () => {
    if (!mounted.current || !ownsScreen() || screen !== 'confirm-phrase' || flow !== 'create' || activeGeneration.current !== generation) return;
    await identityStep(() => live!.command('account-create'));
  };
  // The quiz is keyed by the phrase, so the words are dropped only once the runtime has moved on to the password step.
  useLayoutEffect(() => { if (screen === 'password' && flow === 'create' && phrase.length) setPhrase([]); }, [screen, flow, phrase, setPhrase]);
const restoreAccount = (words: string[]) => { activeGeneration.current = undefined; setFlow('restore'); return identityStep(() => live!.command('account-login', { words: words.map(word => word.trim().toLowerCase()) })); };
// A finished registration stays on screen as a drawn check for a beat; a failure stays on the wait screen at the part that
// failed, with its reason, a retry with the same PIN, and a way back to the PIN step (which kept its digits underneath).
const setPassword = (password: string): Promise<void> => identityStep(async () => {
  setWorking(true);
  try { await live!.command('password-set', { password }); }
  catch (error) { if (mounted.current) setWorking({ error: failureText(error), retry: () => void setPassword(password), back: () => setWorking(false) }); return; }
  setWorking('done');
  try { await new Promise(resolve => setTimeout(resolve, DONE_HOLD_MS)); } finally { setWorking(false); }
  if (data.pendingInvite) getActions().openInvitation(); else getActions().go('chat');
});
  return { startCreate, previewInvite, createAccount, restoreAccount, setPassword };
}
