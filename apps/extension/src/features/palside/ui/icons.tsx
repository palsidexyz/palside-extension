import type { ReactNode, SVGProps } from 'react';
import { Highlighter, MapPin } from 'lucide-react';
import type { InteractionFeature } from '../../../domain/annotations/interaction';
import type { Stance } from '../../../runtime/rooms/contract-types';

/** Drawn on lucide's grid (24px, 2px round strokes) so they sit beside lucide icons. */
function Glyph({ size = 16, children, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}

/** 看多 / 观望 / 看空: one family — a ring with the direction inside: up, level, down. */
export function StanceIcon({ value, size }: { value: Stance; size?: number }) {
  return <Glyph size={size}>
    <circle cx="12" cy="12" r="9" />
    {value === 'bull' && <><path d="M9 15 15 9" /><path d="M10 9h5v5" /></>}
    {value === 'hold' && <><path d="M7.5 12h9" /><circle cx="12" cy="12" r=".5" fill="currentColor" /></>}
    {value === 'bear' && <><path d="M9 9l6 6" /><path d="M15 10v5h-5" /></>}
  </Glyph>;
}

/** 弹幕: lines of different lengths passing at different heights, the way danmaku crosses a page. */
export function DanmakuIcon({ size }: { size?: number }) {
  return <Glyph size={size}>
    <path d="M10 6h10" /><path d="M4 6h2" />
    <path d="M4 12h11" /><path d="M19 12h1" />
    <path d="M8 18h8" />
  </Glyph>;
}

/** 共享在看: lucide's Radio geometry with explicit wave groups so the composer can pulse them. */
export function ShareIcon({ size, className }: { size?: number; className?: { center?: string; inner?: string; outer?: string } }) {
  return <Glyph size={size}>
    <circle className={className?.center} cx="12" cy="12" r="2" />
    <g className={className?.inner}><path d="M16.247 7.761a6 6 0 0 1 0 8.478" /><path d="M7.753 16.239a6 6 0 0 1 0-8.478" /></g>
    <g className={className?.outer}><path d="M19.075 4.933a10 10 0 0 1 0 14.134" /><path d="M4.925 19.067a10 10 0 0 1 0-14.134" /></g>
  </Glyph>;
}

/** The three 网页互动 features, as drawn in settings. */
export const featureIcons: Record<InteractionFeature, () => ReactNode> = { signal: () => <MapPin size={16} />, sticky: () => <Highlighter size={16} /> };

const chromeSector = 'M6.68 14A20 20 0 0 1 41.32 14H24A10 10 0 0 0 15.34 29Z';
/** Chrome, in its own colours: marks what Chrome itself grants, next to the permission's name as Chrome words it. */
export function ChromeMark({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="4 4 40 40" aria-hidden="true" style={{ flex: 'none' }}>
    <path fill="#EA4335" d={chromeSector} />
    <path fill="#FBBC04" d={chromeSector} transform="rotate(120 24 24)" />
    <path fill="#34A853" d={chromeSector} transform="rotate(240 24 24)" />
    <circle cx="24" cy="24" r="10" fill="#fff" />
    <circle cx="24" cy="24" r="8" fill="#1A73E8" />
  </svg>;
}
