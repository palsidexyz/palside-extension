import { useMemo } from 'react';
import { chatTime,type Locale } from '@palside/i18n';
import type { Message } from '../../../domain/chat/model';
import type { Team } from '../../../domain/teams/model';

export function useFormattedTeams(source: Team[], t: (key: string) => string) {
  return useMemo(() => source.map(team => team.name ? team : { ...team, name: t(team.readonly ? 'common.formerTeam' : 'common.team') }), [source, t]);
}
export function useFormattedMessages(source: Message[], locale: Locale, today: number, t: (key: string) => string) {
  return useMemo(() => source.map(item => ({ ...item, time: chatTime(item.timestamp, locale, today), attachment: item.attachment?.kind === 'image' && !item.attachment.name ? { ...item.attachment, name: t('extension.copy.image') } : item.attachment })), [source, locale, today, t]);
}
export function useCurrentMessages(messages: Message[], current: string) {
  return useMemo(() => messages.filter(m => m.teamId === current), [messages, current]);
}
