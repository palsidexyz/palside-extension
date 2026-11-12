import type { ReactNode, SVGProps } from 'react';
import { ChartCandlestick, MapPin } from 'lucide-react';
import type { InteractionFeature } from '../../../domain/annotations/interaction';
import { LIKE_THUMB_PATHS } from '@palside/shared/like-art';

/** Drawn on lucide's grid (24px, 2px round strokes) so they sit beside lucide icons. */
function Glyph({ size = 16, children, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}

/** 弹幕: lines of different lengths passing at different heights, the way danmaku crosses a page. */
export function DanmakuIcon({ size }: { size?: number }) {
  return <Glyph size={size}>
    <path d="M10 6h10" /><path d="M4 6h2" />
    <path d="M4 12h11" /><path d="M19 12h1" />
    <path d="M8 18h8" />
  </Glyph>;
}

/** 点赞: an outlined thumb until liked, then the same shapes filled solid. */
export function LikeIcon({ size = 16, filled = false }: { size?: number; filled?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 1 : 1.7} strokeLinejoin="round" aria-hidden="true" style={{ overflow: 'visible' }}>
    {LIKE_THUMB_PATHS.map(d => <path key={d} d={d} />)}
  </svg>;
}

/** 热门: a filled two-tone flame, orange around a yellow core, flat; the one coloured icon in the header. */
export function HotIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path fill="var(--ui-ink-flame)" d="M12.6 2.2c.3 2.9 2 4.4 3.6 6.1 1.5 1.6 2.8 3.4 2.8 6.1A7 7 0 0 1 12 21.5a7 7 0 0 1-7-7c0-2.5 1.2-4.3 2.6-5.7.2 1.6 1 2.8 2.3 3.3-.6-3.9.6-7.4 2.7-9.9Z" />
    <path fill="var(--ui-ink-flame-core)" d="M12.2 12.8c-1.7 1.4-2.7 2.7-2.7 4.3a2.6 2.6 0 0 0 5.2 0c0-1.6-1-2.9-2.5-4.3Z" />
  </svg>;
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
export const featureIcons: Record<InteractionFeature, () => ReactNode> = { signal: () => <MapPin size={16} />, chart: () => <ChartCandlestick size={16} /> };

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
