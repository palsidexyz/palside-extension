import { emptyFavorites,type Favorites,type SiteInteractions } from '../../../domain/annotations/interaction';
import { useState } from 'react';
import { type Draft } from '../../../domain/chat/model';
import { type Team } from '../../../domain/teams/model';
import type { PanelDataInput,PanelData } from './panel-data';
export function useMemoryData({ data, scenario, initialTeam }: PanelDataInput): PanelData {
const [localPeople, setPeople] = useState(data.people);
const [localTeams, setTeams] = useState<Team[]>(() => data.teams.map(t => ({ ...t, joined: scenario === 'empty' ? false : t.joined, readonly: scenario === 'readonly' && t.id === initialTeam.id })));
const [localMessages, setMessages] = useState(() => scenario === 'history' ? data.messages.filter(m => m.id === 'n5') : data.messages);
const [localAllRequests, setRequests] = useState(data.requests);
const [localCurrent, setCurrent] = useState(initialTeam.id);
const [localSiteInteraction, setLocalSiteInteraction] = useState<SiteInteractions>({});
const [localFavorites, setLocalFavorites] = useState<Favorites>(emptyFavorites);
const [localDrafts, setDrafts] = useState<Record<string, Draft>>({});
const [localShare, setLocalShare] = useState(false);
const [localSites, setLocalSites] = useState<string[]>(['gmgn.ai', 'dexscreener.com']);
const [localOffline, setOffline] = useState(scenario === 'offline');
const [localViewingId, setViewingId] = useState(data.people.find(p => p.id === data.self)?.viewing);
  return { localPeople, setPeople, localTeams, setTeams, localMessages, setMessages, localAllRequests, setRequests, localCurrent, setCurrent, localSiteInteraction, setLocalSiteInteraction, localFavorites, setLocalFavorites, localDrafts, setDrafts, localShare, setLocalShare, localSites, setLocalSites, localOffline, setOffline, localViewingId, setViewingId };
}
