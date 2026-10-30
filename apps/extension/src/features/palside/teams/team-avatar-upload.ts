import { message as uiMessage, MessageError } from '@palside/i18n';
import type { LivePort } from '../app/live-port';
import { readImage } from '../account/read-image';

/** Saves a new team's avatar: a preset path is fetched and sent like an upload; a data URL is sent as is. */
export async function saveTeamAvatar(live: LivePort, accountId: string, teamId: string, avatar: string) {
  let data = avatar;
  if (!avatar.startsWith('data:')) {
    const response = await fetch(avatar);
    if (!response.ok) throw new MessageError(uiMessage('extension.copy.avatarLoadFailed'));
    data = await readImage(await response.blob());
  }
  await live.command('avatar', { accountId, data, teamId });
}
