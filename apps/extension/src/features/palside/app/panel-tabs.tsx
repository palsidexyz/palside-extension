'use client';
import { useTranslations } from 'use-intl';
import { ChevronRight } from 'lucide-react';
import { Tooltip } from '@palside/ui/tooltip';
import { Token } from '../ui/primitives';
import { roomView, tabRoomKey, useShownRoomKey } from '../rooms/rooms';
import { ChainPicker, tabChainChoices } from '../assets/chain-picker';
import type { PalsideController } from './use-palside';
import s from './panel-tabs.module.css';
import { TokenName,tokenLabel } from '../assets/token-name';

/** On 弹幕 the title is the token and 币名 › on one line, opening 详情; the header puts 👁 N after it. Without a token it just says 弹幕. */
export function RoomTitle({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const key = useShownRoomKey(c);
  if (!key) return <h1 className={s.plain}>{t('extension.room.name')}</h1>;
  const view = roomView(c, key);
  const label = t('extension.current.detail', { name: tokenLabel(view, t, c) });
  // The tab's address is a token on several chains: 切换链 sits after the title, and 弹幕 follows the tab onto the picked chain.
  const asset = key.slice('token:'.length), choices = tabRoomKey(c) === key ? tabChainChoices(c, asset) : [];
  const title = <Tooltip content={label}><button type="button" className={s.title} aria-label={label} onClick={() => c.selectAsset(view.id, view)}>
    <Token view={view} size="sm" />
    <h1 data-header-name><TokenName c={c} view={view} /></h1><ChevronRight className={s.chevron} size={14} strokeWidth={2.2} aria-hidden="true" />
  </button></Tooltip>;
  if (choices.length < 2) return title;
  return <span className={s.titleRow}>{title}<ChainPicker c={c} assets={choices} current={asset} onPick={pick => { void c.live.command('page-chain', { asset: pick }).catch(() => {}); }} /></span>;
}
