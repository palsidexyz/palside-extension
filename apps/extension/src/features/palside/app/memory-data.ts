import { defaultInteraction,defaultWebFeatures,emptyFavorites,type Favorites,type InteractionPrefs,type WebFeatures } from '../../../domain/annotations/interaction';
import type { Toggles } from '../../../domain/account/preferences';
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
const [localInteraction, setLocalInteraction] = useState<InteractionPrefs>(defaultInteraction);
const [localFavorites, setLocalFavorites] = useState<Favorites>(emptyFavorites);
const [localDrafts, setDrafts] = useState<Record<string, Draft>>({});
const [localWeb, setLocalWeb] = useState<WebFeatures>(defaultWebFeatures);
const [localToggles, setLocalToggles] = useState<Toggles>({ share: false, interact: false });
const [localSites, setLocalSites] = useState<string[]>(['gmgn.ai', 'dexscreener.com']);
const [localTokenOff, setLocalTokenOff] = useState<string[]>([]);
const [localOffline, setOffline] = useState(scenario === 'offline');
const [localViewingId, setViewingId] = useState(data.people.find(p => p.id === data.self)?.viewing);
  return { localPeople, setPeople, localTeams, setTeams, localMessages, setMessages, localAllRequests, setRequests, localCurrent, setCurrent, localInteraction, setLocalInteraction, localFavorites, setLocalFavorites, localDrafts, setDrafts, localWeb, setLocalWeb, localToggles, setLocalToggles, localSites, setLocalSites, localTokenOff, setLocalTokenOff, localOffline, setOffline, localViewingId, setViewingId };
}
