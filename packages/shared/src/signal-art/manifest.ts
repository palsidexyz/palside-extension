import { signalEmotes, signalKinds, type SignalEmote, type SignalKind } from '../signals.ts';

export interface PingTag { name: string; color: number }
export interface SignalPing {
  id: SignalKind;
  icon: string;
  art: string;
  sound: string;
  color: string;
}
export interface SignalEmoteArt {
  id: SignalEmote;
  /** 96 px still for the wheel. */
  icon: string;
  /** 256 px still the emote envelope animates. */
  image: string;
  sound: string;
}
/** The glow and ring colour each signal's art is drawn with. */
const SIGNAL_COLORS: Record<SignalKind, string> = {
  danger: '#ff3b55', watch: '#35d27a', together: '#2e8bff', agree: '#56d43c',
  help: '#35d27a', attention: '#ff8a1e', question: '#f2c518', disagree: '#ff3b55',
};
/** `base` is the caller's signals/ directory URL, e.g. runtime.getURL('signals/'). */
export function createSignalManifest(base: string) {
  const root = base.endsWith('/') ? base : `${base}/`;
  const url = (path: string): string => `${root}${path}`;
  return {
    pings: signalKinds.map((id): SignalPing => ({ id, icon: url(`art/${id}.svg`), art: url(`art/${id}.svg`), sound: url(`sounds/${id}.m4a`), color: SIGNAL_COLORS[id] })),
    emotes: signalEmotes.map((id): SignalEmoteArt => ({ id, icon: url(`thumbs/${id}.webp`), image: url(`emotes/${id}.webp`), sound: url(`sounds/${id}.m4a`) })),
    tickSound: url('sounds/tick.m4a'),
  };
}
export type SignalManifest = ReturnType<typeof createSignalManifest>;
