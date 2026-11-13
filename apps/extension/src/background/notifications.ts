import { parseCommand } from '../runtime/transport/command-map.ts';
import { translator } from '@palside/i18n';
import { notificationTarget,notificationValid,pokeNotificationTarget,type NotificationIdentity } from '../runtime/chat/notification-policy.ts';
import type { RuntimeState } from '../runtime/composition/runtime-state';
import type { Background } from './index.ts';

const PREFIX = 'palside:';

/**
 * Desktop notifications for chat messages and 喊你来看, when 通知 is granted. Each one keeps a small local record (account, message, team,
 * preview) so a click can open the right place; records go when the notification closes or stops being valid.
 */
export function notifications(bg: Background) {
  const { browser } = bg;
  /** Bumped when who may be notified, or how, changes; a notification being created under an older value is withdrawn. */
  let epoch = 0;
  let listening = false;
  const clicked = new Set<string>();
  const granted = () => browser.permissions.contains({ permissions: ['notifications'] });

  async function forget(id: string, clear = false) {
    if (clear) await browser.notifications.clear(id);
    await browser.storage.local.remove(id);
  }

  return {
    async clearAccount(accountId: string) {
      epoch++;
      const local = await browser.storage.local.get(null);
      for (const id of Object.keys(local)) if (id.startsWith(`${PREFIX}${accountId}:`)) {
        if (await granted()) await browser.notifications.clear(id);
        await browser.storage.local.remove(id);
      }
    },
    /** Notifications exist only under the optional permission, so their listeners attach once it is first available. */
    listenNotifications() {
      if (listening || !browser.notifications?.onClicked) return;
      listening = true;
      browser.notifications.onClosed.addListener(id => {
        if (id.startsWith(PREFIX) && !clicked.has(id)) void browser.storage.local.remove(id).catch(() => {});
      });
      browser.notifications.onClicked.addListener(id => {
        if (!id.startsWith(PREFIX) || clicked.has(id)) return;
        clicked.add(id);
        void (async () => {
          let opened = false;
          try {
            const value = (await browser.storage.local.get(id))[id];
            const stored = value && typeof value === 'object' ? value as NotificationIdentity : undefined;
            // Palside does not run in incognito: a click while an incognito window is in front opens the most recent normal window.
            let window = await browser.windows.getLastFocused();
            if (window.incognito) window = (await browser.windows.getAll({ windowTypes: ['normal'] })).find(item => !item.incognito && item.id !== undefined) ?? window;
            if (window.id === undefined || window.incognito) return;
            opened = true;
            await browser.sidePanel.open({ windowId: window.id });
            // 喊你来看 opens the squad and then the page it called to; a message opens the squad at the message.
            if (stored?.pokeId !== undefined) {
              const result = await bg.run(parseCommand({ name: 'poke-open', payload: { accountId: stored.accountId, pokeId: stored.pokeId } }));
              if (result.ok && result.value && typeof (result.value as { url?: unknown }).url === 'string') await bg.openPage((result.value as { url: string }).url);
              else bg.notifyWindow(window.id, result);
              return;
            }
            const result = await bg.run(parseCommand({ name: 'notification-open', payload: { ...stored, windowId: window.id } }));
            bg.notifyWindow(window.id, result);
          } finally {
            // Without a normal window the notification stays, so the message can still be reached from it later.
            try { if (opened) await forget(id, true); } finally { clicked.delete(id); }
          }
        })().catch(() => {});
      });
    },
    /** The offscreen document asks to notify a message: rechecked against the current state before and after creation. */
    async notify(identity: NotificationIdentity) {
      if (identity.pokeId !== undefined) return this.notifyPoke(identity);
      const started = epoch;
      const current = () => started === epoch && notificationTarget(bg.state, identity);
      if (!current() || !await granted() || !current()) return;
      const { accountId, messageId, teamId, preview } = identity;
      const id = `${PREFIX}${accountId}:${messageId}`;
      await browser.storage.local.set({ [id]: { accountId, messageId, teamId, preview } });
      if (!current()) { await forget(id); return; }
      try {
        const t = translator((await bg.language.get()).locale);
        const target = current();
        if (!target) { await forget(id); return; }
        const person = bg.state?.data.people.find(person => person.id === target.message.author);
        const author = person?.deleted ? t('common.deletedMember') : person?.name || t('common.member');
        const content = preview
          ? t('extension.runtime.notificationPreview', { author, content: target.message.text.slice(0, 120) || t(target.message.attachment?.kind === 'image' ? 'extension.copy.imageQuote' : 'extension.copy.tokenQuote') })
          : t(target.mentioned ? 'extension.runtime.notificationMention' : target.replied ? 'extension.runtime.notificationReply' : 'extension.runtime.notificationMessage', { author });
        await browser.notifications.create(id, { type: 'basic', iconUrl: browser.runtime.getURL('/icon-128.png'), title: target.team.name, message: content });
      } catch { await forget(id); return; }
      if (!current()) await forget(id, true);
    },
    /** 喊你来看: “Robin 喊你来看 CHUMP”, or without the page while 显示内容 is off. Rechecked before and after creation. */
    async notifyPoke(identity: NotificationIdentity) {
      const started = epoch;
      const current = () => started === epoch ? pokeNotificationTarget(bg.state, identity) : undefined;
      if (!current() || !await granted() || !current()) return;
      const { accountId, teamId, pokeId, preview } = identity;
      const id = `${PREFIX}${accountId}:poke:${pokeId}`;
      await browser.storage.local.set({ [id]: { accountId, teamId, pokeId, preview } });
      try {
        const t = translator((await bg.language.get()).locale);
        const target = current();
        if (!target) { await forget(id); return; }
        const person = bg.state?.data.people.find(person => person.id === target.poke.from);
        const name = person?.deleted ? t('common.deletedMember') : person?.name || t('common.member');
        const content = preview ? t('extension.runtime.notificationPokePage', { name, page: target.poke.view.name }) : t('extension.runtime.notificationPoke', { name });
        await browser.notifications.create(id, { type: 'basic', iconUrl: browser.runtime.getURL('/icon-128.png'), title: target.team.name, message: content });
      } catch { await forget(id); return; }
      if (!current()) await forget(id, true);
    },
    /** The state changed: withdraw notifications that are no longer valid (read, recalled, answered, muted, another account). */
    notificationState(previous: RuntimeState | undefined, next: RuntimeState) {
      const who = (state: RuntimeState | undefined) => [state?.account?.id, state?.authenticated, state?.preferences.notifications, state?.preferences.notificationPreview];
      if (JSON.stringify(who(previous)) !== JSON.stringify(who(next))) epoch++;
      if (previous?.authenticated === next.authenticated && previous?.account?.id === next.account?.id && previous?.remoteTeams === next.remoteTeams && previous?.data.messages === next.data.messages && previous?.pokes === next.pokes && previous?.preferences.notifications === next.preferences.notifications && previous?.preferences.notificationPreview === next.preferences.notificationPreview) return;
      void (async () => {
        if (!await granted()) return;
        for (const id of Object.keys(await browser.notifications.getAll())) if (id.startsWith(PREFIX)) {
          const stored = (await browser.storage.local.get(id))[id];
          if (!notificationValid(bg.state, stored ?? {})) await forget(id, true);
        }
      })().catch(() => {});
    },
  };
}
