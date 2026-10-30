import type { Viewing } from './assets.ts';
export type Attachment =
  | { kind: 'asset'; assetId: string; view?: Viewing }
  | { kind: 'image'; src: string; name: string };
export type Message = {
  timestamp?: number;
  liveArrival?: boolean;
  id: string;
  teamId: string;
  author: string;
  text: string;
  time: string;
  attachment?: Attachment;
  replyTo?: string;
  status: 'sent' | 'sending' | 'waiting' | 'uncertain' | 'failed';
  edited?: boolean;
  recalled?: boolean;
};
export type Draft = {
  text: string;
  attachment?: Attachment;
  replyTo?: string;
};
