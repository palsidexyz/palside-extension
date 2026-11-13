import type { onFollowStatus, requestFollow } from '../../../runtime/transport/bridge';
import type { RoomKey } from '../../../runtime/rooms/contract-types';
import type { DanmakuSettings,PageStatus } from '../../../runtime/browser/page-protocol';
import type { CommandFunction } from '../../../runtime/transport/command-map';
import type { RuntimeState } from '../../../runtime/composition/runtime-state.ts';
import type { SiteIcon } from '../../../domain/assets/site-icon.ts';
import type { UpdateStatus } from '../../../runtime/browser/extension-update.ts';
export type LivePort = { page?: PageStatus; danmaku?: DanmakuSettings; siteIcons?: Readonly<Record<string, SiteIcon>>; update?: UpdateStatus; state: RuntimeState; command: CommandFunction; openPage: (url: string) => Promise<void>; onOpenRoom?: (listener: (key: RoomKey, packet?: string) => void) => () => void; onCaptured?: (listener: (capture: { src: string; teamId?: string }) => void) => () => void; follow?: typeof requestFollow; onFollowStatus?: typeof onFollowStatus };
