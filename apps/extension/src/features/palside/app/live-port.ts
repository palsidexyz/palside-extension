import type { RoomKey } from '../../../runtime/rooms/contract-types';
import type { DanmakuSettings,PageStatus } from '../../../runtime/browser/page-protocol';
import type { CommandFunction } from '../../../runtime/transport/command-map';
import type { RuntimeState } from '../../../runtime/composition/runtime-state.ts';
export type LivePort = { page?: PageStatus; danmaku?: DanmakuSettings; state: RuntimeState; command: CommandFunction; openPage: (url: string, reuse?: boolean) => Promise<void>; onOpenRoom?: (listener: (key: RoomKey) => void) => () => void; onCaptured?: (listener: (capture: { src: string; teamId?: string }) => void) => () => void };
