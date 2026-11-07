'use client';
import { useState } from 'react';

/** Past this, a save still running shows its spinner; a faster one never flashes it. */
const SLOW_MS = 300;
/** A saved value the confirmed state never catches up with (another device changed it meanwhile) gives way after this. */
const SETTLE_MS = 3000;

type Saving = { wanted?: boolean; phase: 'idle' | 'saving' | 'saved'; slow: boolean; refused: number };

/**
 * One rule for every switch the service saves: the switch moves at once, a spinner shows only while a slow save is unconfirmed, and a
 * refused save goes back and shakes (the command already says why). `confirmed` is the service's value; it takes over once it agrees.
 */
export function useSavingSwitch(confirmed: boolean) {
  const [state, setState] = useState<Saving>({ phase: 'idle', slow: false, refused: 0 });
  if (state.phase === 'saved' && confirmed === state.wanted) setState({ ...state, phase: 'idle', wanted: undefined });

  /** `work` resolves true once saved, false when refused. */
  async function save(next: boolean, work: () => Promise<boolean>) {
    if (state.phase === 'saving') return;
    setState(old => ({ ...old, wanted: next, phase: 'saving', slow: false }));
    const slow = setTimeout(() => setState(old => old.phase === 'saving' ? { ...old, slow: true } : old), SLOW_MS);
    let saved = false;
    try { saved = await work(); } catch { saved = false; }
    clearTimeout(slow);
    if (!saved) { setState(old => ({ phase: 'idle', wanted: undefined, slow: false, refused: old.refused + 1 })); return; }
    setState(old => ({ ...old, phase: 'saved', slow: false }));
    setTimeout(() => setState(old => old.phase === 'saved' && old.wanted === next ? { ...old, phase: 'idle', wanted: undefined } : old), SETTLE_MS);
  }

  return { checked: state.wanted ?? confirmed, pending: state.phase === 'saving' && state.slow, busy: state.phase === 'saving', refused: state.refused, save };
}
