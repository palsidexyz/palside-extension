'use client';
import { useTranslations } from 'use-intl';
import { Token } from '../ui/primitives';
import { TokenName } from '../assets/token-name';
import { tokenView } from '../assets/token-data';
import { openRoom } from './rooms';
import type { RoomKey } from '../../../runtime/rooms/contract-types';
import type { PalsideController } from '../app/use-palside';
import r from './recent-tokens.module.css';

/** 最近看过: the last 弹幕 this account opened, as chips that reopen them. Memory only; nothing shows before the first one. */
export function RecentTokens({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const keys = (c.live?.state.recentRooms ?? []) as RoomKey[];
  if (!keys.length) return null;
  return <div className={r.recent} role="group" aria-label={t('extension.room.recent')}>
    {keys.map(key => {
      const view = tokenView(c, key.slice('token:'.length));
      return <button key={key} type="button" className={r.chip} onClick={() => openRoom(c, key)}>
        <Token view={view} size="xs" /><span><TokenName c={c} view={view} /></span>
      </button>;
    })}
  </div>;
}
