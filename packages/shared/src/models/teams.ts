export type Team = {
  ownerName?: string;
  ownerAvatar?: string;
  memberCount?: number;
  avatar?: string;
  id: string;
  name: string;
  description: string;
  owner: string;
  memberIds: string[];
  joined: boolean;
  published: boolean;
  muted: boolean;
  unread: number;
};
export type Request = {
  id: string;
  personId: string;
  teamId: string;
  text: string;
};
