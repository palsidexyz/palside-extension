import { defaultInteraction,defaultWebFeatures,emptyFavorites } from '../../../domain/annotations/interaction';
import type { PanelData,PanelDataInput } from './panel-data';
export function livePanelData({ data, scenario, initialTeam }: PanelDataInput): PanelData {
  return {
    localPeople: data.people,
    setPeople: () => {},
    localTeams: data.teams,
    setTeams: () => {},
    localMessages: data.messages,
    setMessages: () => {},
    localAllRequests: data.requests,
    setRequests: () => {},
    localCurrent: initialTeam.id,
    setCurrent: () => {},
    localInteraction: defaultInteraction,
    setLocalInteraction: () => {},
    localFavorites: emptyFavorites,
    setLocalFavorites: () => {},
    localDrafts: {},
    setDrafts: () => {},
    localWeb: defaultWebFeatures,
    setLocalWeb: () => {},
    localToggles: { share: false, interact: false },
    setLocalToggles: () => {},
    localSites: ['gmgn.ai', 'dexscreener.com'],
    setLocalSites: () => {},
    localTokenOff: [],
    setLocalTokenOff: () => {},
    localOffline: scenario === 'offline',
    setOffline: () => {},
    localViewingId: data.people.find(p => p.id === data.self)?.viewing,
    setViewingId: () => {},
  };
}
