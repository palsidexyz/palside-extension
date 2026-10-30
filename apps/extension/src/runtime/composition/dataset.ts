import type { Person } from '../../domain/account/model.ts';
import type { Viewing } from '../../domain/assets/model.ts';
import type { Message } from '../../domain/chat/model.ts';
import type { Request,Team } from '../../domain/teams/model.ts';

export type Dataset = {
  pendingInvite?: string;
  openTeam?: string;
  self: string;
  people: Person[];
  views: Viewing[];
  teams: Team[];
  messages: Message[];
  requests: Request[];
};
