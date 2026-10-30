'use client';
import { errorMessage, message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { useState } from 'react';
import { Tooltip } from '@palside/ui/tooltip';
import { locateFeedback } from './locate-feedback';
import { viewAsset } from '../../../domain/annotations/social';
import type { Message } from '../../../domain/chat/model';
import { composerStyles as s, RefLine } from '../chat/composer-social';
import { openRoom, roomKeyFor, roomsOn } from '../rooms/rooms';
import { captureSocialUi, navigateWithReturn, setSocialUi } from './social-state';
import { withTargetAccess } from '../settings/access';
import type { PalsideController } from '../app/use-palside';

/** The reference at the top of a bubble: one click finds it again on the page, opening the token first if needed; a 弹幕 line opens that token's 弹幕 at the line. */
export function MessageRef({ c, message }: { c: PalsideController; message: Message & { ref: NonNullable<Message['ref']> } }) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  function locate() {
    if (!c.live || busy) return;
    const target = message.ref.target, key = roomKeyFor(message.ref.view);
    if (target.kind === 'danmaku') {
      if (!key || !roomsOn(c)) { c.setNotice(uiMessage('extension.composer.refUnavailable')); return; }
      setSocialUi({ roomLine: target.id }); openRoom(c, key); return;
    }
    const session = captureSocialUi();
    withTargetAccess(c, message.ref.view.url, () => {
      if (!session.current() || !c.ownsScreen()) return;
      setBusy(true);
      const asset = viewAsset(message.ref.view);
      const destination = target.kind !== 'quote' && asset && c.live?.page?.asset === asset ? c.live.page.url ?? message.ref.view.url : message.ref.view.url;
      void navigateWithReturn(c.live!, destination, () => c.live!.command('locate-ref', { teamId: c.current, messageId: message.id }))
        .then(result => { const key = locateFeedback[result]; if (session.current() && key) c.setNotice(uiMessage(key)); }, error => { if (session.current()) c.setNotice(errorMessage(error)); })
        .finally(() => setBusy(false));
    });
  }
  return <Tooltip content={message.ref.caption}>
    <button type="button" className={s.refChip} aria-busy={busy} aria-label={t('extension.composer.findRef', { caption: message.ref.caption })} onClick={locate}><RefLine c={c} ref_={message.ref} /></button>
  </Tooltip>;
}
