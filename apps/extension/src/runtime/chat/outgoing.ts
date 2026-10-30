import type { Message } from '../../domain/chat/model';
import type { Viewing } from '../../domain/assets/model';
export type Outgoing = { attempted?: boolean; receivedAt?: number; draftRevision?: number; message: Message; asset?: Viewing; createdAt: number; eventId?: string; uploadId?: string; file?: Record<string, unknown> };
