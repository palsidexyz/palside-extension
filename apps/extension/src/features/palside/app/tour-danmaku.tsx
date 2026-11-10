'use client';
import { useTranslations } from 'use-intl';
import s from './tour-danmaku.module.css';

/**
 * The 弹幕 scene's lines as the page layer draws them (page-layer/danmaku-renderer.ts): plain outlined text, a teammate's in
 * their tint, your own framed, 点赞 as a thumb and a count; hovering a line holds it and shows who said it.
 */
type Line = { key: 'demoDanmaku1' | 'demoDanmaku2' | 'demoDanmaku3' | 'demoDanmaku4' | 'demoDanmaku5' | 'demoDanmaku6'; lane: 0 | 1 | 2; at: number; mate?: boolean; self?: boolean; likes?: number };
/** `at`: how far across the line is when the scene starts (below 0 = not in yet). The teammate's line is the one the pointer holds. */
export const DM_LINES: readonly Line[] = [
  { key: 'demoDanmaku1', lane: 0, at: .45, likes: 12 },
  { key: 'demoDanmaku2', lane: 1, at: .04, mate: true },
  { key: 'demoDanmaku3', lane: 2, at: .56, self: true },
  { key: 'demoDanmaku4', lane: 0, at: -.5 },
  { key: 'demoDanmaku5', lane: 2, at: -.22, likes: 3 },
  { key: 'demoDanmaku6', lane: 1, at: -.98 },
];
export const HELD = DM_LINES.findIndex(line => line.mate);
/** One crossing of the stage, and the lanes' tops in stage pixels (under the chart's interval bar). */
export const DM_MS = 5600;
export const LANES = [26, 52, 78] as const;

export type Card = { x: number; y: number } | undefined;

export function DanmakuLayer({ card }: { card: Card }) {
  const t = useTranslations();
  return <span className={s.layer}>
    {DM_LINES.map((line, index) => <span key={line.key} className={s.dm} data-dm={index} style={{ top: LANES[line.lane] }}
      data-mate={line.mate || undefined} data-self={line.self || undefined} data-held={(card && index === HELD) || undefined}>
      {t(`extension.tour.${line.key}`)}
      {line.likes && <span className={s.likes}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></svg>{line.likes}</span>}
    </span>)}
    <span className={s.card} data-on={card ? '' : undefined} style={card && { left: card.x, top: card.y }}>
      <span className={s.face}>{t('extension.tour.demoMate').slice(0, 1)}</span>
      <b>{t('extension.tour.demoMate')}</b>
      <span className={s.tag}>{t('extension.room.mate')}</span>
      <time>{t('common.justNow')}</time>
    </span>
  </span>;
}
