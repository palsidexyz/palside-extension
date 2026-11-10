'use client';
import { useTranslations } from 'use-intl';
import { Check, ChevronDown } from 'lucide-react';
import { Tooltip } from '@palside/ui/tooltip';
import { Menu, MenuTrigger, MenuContent, MenuItem } from '@palside/ui/menu';
import { roomKeyForAsset } from '@palside/shared/contracts/rules';
import { ChainLogo } from './chain-identity';
import { tokenStats, tokenView } from './token-data';
import { tokenLabel } from './token-name';
import type { PalsideController } from '../app/use-palside';
import s from './chain-picker.module.css';

const chainOf = (asset: string) => asset.slice(0, asset.indexOf(':'));

/** The candidates the active tab's address has when it is a token on several chains, current first; empty otherwise. */
export function tabChainChoices(c: PalsideController, asset: string | undefined) {
  const choices = c.live?.state.pageChoices;
  if (!asset || !choices) return [];
  return Object.values(choices).find(candidates => candidates[0] === asset && candidates.length > 1) ?? [];
}

/**
 * 切换链: shown only when one contract address is a token on several chains. The chip names the current chain; the menu lists
 * each chain with the token's name there and how many watch its 弹幕 when known. The pick is remembered for the address.
 */
export function ChainPicker({ c, assets, current, onPick, align = 'start' }: { c: PalsideController; assets: string[]; current: string; onPick: (asset: string) => void; align?: 'start' | 'end' }) {
  const t = useTranslations();
  if (assets.length < 2) return null;
  const label = t('extension.room.chainSwitch');
  return <Menu boundarySelector="[data-palside-app]" align={align}>
    <Tooltip content={label}><MenuTrigger asChild><button type="button" className={s.trigger} aria-label={`${label} · ${chainOf(current)}`}>
      <span>{chainOf(current)}</span><ChevronDown size={12} strokeWidth={2.4} aria-hidden="true" />
    </button></MenuTrigger></Tooltip>
    <MenuContent aria-label={label} className={s.menu}>
      <div className={s.head}>{t('extension.room.onChains', { count: assets.length })}</div>
      {assets.map(asset => {
        const key = roomKeyForAsset(asset), count = key ? tokenStats(c, key)?.count : undefined;
        return <MenuItem key={asset} icon={<ChainLogo chain={chainOf(asset)} />} aria-current={asset === current || undefined} onClick={() => { if (asset !== current) onPick(asset); }}>
          <span className={s.option}>
            <span className={s.chain}>{chainOf(asset)}</span><small className={s.name}>{tokenLabel(tokenView(c, asset), t, c)}</small>
            {count ? <small className={s.count}>{t('extension.room.watching', { count })}</small> : null}
            {asset === current && <Check size={14} aria-hidden="true" />}
          </span>
        </MenuItem>;
      })}
    </MenuContent>
  </Menu>;
}
