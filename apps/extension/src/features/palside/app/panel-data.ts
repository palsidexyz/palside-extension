import type { Dispatch,SetStateAction } from 'react';
import type { Person } from '../../../domain/account/model';
import type { Team,Request } from '../../../domain/teams/model';
import type { Message,Draft } from '../../../domain/chat/model';
import type { Favorites,InteractionPrefs,WebFeatures } from '../../../domain/annotations/interaction';
import type { Dataset } from '../../../runtime/composition/dataset';
import type { Scenario } from './panel-model';

type Setter<T> = Dispatch<SetStateAction<T>>;
export type PanelDataInput = { data: Dataset; scenario: Scenario; initialTeam: Team };
export type PanelData = {
  localPeople: Person[]; setPeople: Setter<Person[]>;
  localTeams: Team[]; setTeams: Setter<Team[]>;
  localMessages: Message[]; setMessages: Setter<Message[]>;
  localAllRequests: Request[]; setRequests: Setter<Request[]>;
  localCurrent: string; setCurrent: Setter<string>;
  localInteraction: InteractionPrefs; setLocalInteraction: Setter<InteractionPrefs>;
  localFavorites: Favorites; setLocalFavorites: Setter<Favorites>;
  localDrafts: Record<string, Draft>; setDrafts: Setter<Record<string, Draft>>;
  localWeb: WebFeatures; setLocalWeb: Setter<WebFeatures>;
  localToggles: WebFeatures; setLocalToggles: Setter<WebFeatures>;
  localSites: string[]; setLocalSites: Setter<string[]>;
  localTokenOff: string[]; setLocalTokenOff: Setter<string[]>;
  localOffline: boolean; setOffline: Setter<boolean>;
  localViewingId: string | undefined; setViewingId: Setter<string | undefined>;
};
