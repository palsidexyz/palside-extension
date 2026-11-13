'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Search } from 'lucide-react';
import { Input } from '@palside/ui/field';
import { Spinner } from '@palside/ui/spinner';
import { personFor } from '../../../domain/account/model';
import { assetView } from '../../../domain/assets/model';
import { searchMessages, searchNeedle, type MessageHit } from '../../../domain/chat/search';
import { SharedContent } from '../assets/shared-content';
import { CountText } from '../ui/motion-details';
import { EmptyState } from '../ui/empty-state';
import { PersonAvatar } from '../ui/primitives';
import { HistoryMore } from './history-scope';
import { hitSegments } from './text-highlights';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';

/**
 * 搜索消息: one query over this device's readable squad history. While a query is typed, earlier pages load by
 * themselves until the whole history is covered, so "no results" is only said once there is nothing left to search.
 */
export function MessageSearch({ c, onJump }: { c: PalsideController; onJump: (id: string) => void }) {
  const t = useTranslations();
  const needle = searchNeedle(c.query);
  const results = searchMessages(c.currentMessages, c.query);
  const history = c.live.state.history?.[c.current];
  const covering = useHistoryCoverage(c, Boolean(needle));
  const member = t('common.member');
  const snippet = ({ message, field }: MessageHit) => {
    const view = assetView(message.attachment);
    const card = view?.name || (message.attachment?.kind === 'image' ? t('extension.copy.imageQuote') : t('extension.copy.tokenQuote'));
    const shown = field === 'card' ? (view?.name && searchNeedle(view.name).includes(needle) ? view.name : view?.address ?? card) : message.text || card;
    return hitSegments(shown, c.query).map((part, index) => part.hit ? <mark key={index}>{part.text}</mark> : part.text);
  };
  const empty = covering ? t('extension.copy.searchingEarlier') : !history ? t('extension.copy.historyNotLoaded') : needle ? t('extension.copy.noSearchResults') : t('extension.copy.noSearchableMessages');
  return <>
    <Input type="search" autoFocus aria-label={t('extension.copy.searchMessageContent')} leadingIcon={<Search size={16} />} placeholder={t('extension.copy.searchPlaceholder')} value={c.query}
      onChange={event => c.setQuery(event.target.value)}
      // Escape with words in the field clears them; the page closes only from an empty field.
      onKeyDown={event => { if (event.key === 'Escape' && c.query) { event.preventDefault(); event.stopPropagation(); c.setQuery(''); } }} />
    <SharedContent c={c} onJump={onJump} messages={<>
      {results.length > 0 && <div className={s.listCaption}>{needle ? t('extension.copy.searchResults') : t('extension.copy.recentMessages')}<small><CountText text={t('extension.dynamic.messageCount', { count: results.length })} value={results.length} /></small></div>}
      {results.length > 0 && <div className={s.group}>{results.map(hit => {
        const person = personFor(c.people, hit.message.author, member);
        return <button type="button" className={s.searchResult} key={hit.message.id} onClick={() => onJump(hit.message.id)}>
          <PersonAvatar person={person} />
          <span><strong>{person.name}<small>{hit.message.time}</small></strong><p>{snippet(hit)}</p></span>
        </button>;
      })}</div>}
      {results.length > 0
        ? covering ? <Covering /> : <HistoryMore c={c} />
        : <EmptyState icon={covering ? <Spinner size={20} /> : <Search />} title={empty}>{!covering && <HistoryMore c={c} />}</EmptyState>}
    </>} />
  </>;
}

function Covering() {
  const t = useTranslations();
  return <p className={s.historyNote} role="status"><Spinner size={14} className={s.loadingIcon} />{t('extension.copy.searchingEarlier')}</p>;
}

/**
 * Loads earlier history page after page while a search is active. Stops at the start of the history, when the service
 * is unreachable, or after a failed page (the manual 加载更早消息 stays for a retry). True while a page is on its way.
 */
function useHistoryCoverage(c: PalsideController, searching: boolean) {
  const teamId = c.current, live = c.live;
  const history = live.state.history?.[teamId];
  const [failed, setFailed] = useState<string>();
  const wanted = searching && !c.disconnected && !history?.loaded && failed !== teamId;
  useEffect(() => {
    if (!wanted || history?.loading) return;
    void live.command('history', { teamId }).catch(() => setFailed(teamId));
  }, [wanted, history?.loading, live, teamId]);
  return wanted;
}
