'use client';
import { message as uiMessage,failureText } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { useState } from 'react';
import { Check, ClipboardCopy, Code, FileText, Globe, ShieldCheck, Signpost, Tag } from 'lucide-react';
import { browser } from 'wxt/browser';
import { PUBLIC_LINKS } from '@palside/shared/public-links';
import { Button } from '@palside/ui/button';
import { Brand } from '../ui/brand';
import { useExtensionUpdate } from '../feedback/extension-update';
import { SettingGroup, SettingItem } from './setting-rows';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';

/** Set by the integration harness, which has no extension manifest to read. */
declare const __PALSIDE_VERSION__: string | undefined;

function version() {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return typeof __PALSIDE_VERSION__ === 'string' ? __PALSIDE_VERSION__ : undefined;
  }
}

/** 关于: version (with 更新到 x once Chrome has downloaded a newer one, or 更新 when the service needs it), links, and a one-click copy of
 *  what support needs to see. */
export function About({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const live = c.live;
  const update = useExtensionUpdate(c);
  const offerUpdate = Boolean(live && (update.ready || c.connection === 'update-required'));
  const website = live?.state.config.websiteUrl;
  async function copyDiagnostics() {
    if (!live) return;
    try {
      const { text } = await live.command('diagnostics');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      c.setNotice(uiMessage('extension.copy.copyFailed'));
    }
  }
  // 重看引导 clears the saved flag and returns to the chat, where the tour starts again.
  async function replayTour() {
    if (!live) return;
    try {
      await live.command('preferences', { accountId: c.data.self, toured: false });
      c.go('chat');
    } catch (error) {
      c.setNotice(failureText(error));
    }
  }
  const links = [['', t('extension.copy.aboutWebsite'), <Globe key="" size={16} />], ['/privacy', t('extension.copy.aboutPrivacy'), <ShieldCheck key="" size={16} />], ['/terms', t('extension.copy.aboutTerms'), <FileText key="" size={16} />]] as const;
  return <>
    <div className={s.aboutHero}><Brand /><p>{t('extension.copy.exploreWithFriends')}</p></div>
    <SettingGroup>
      <SettingItem icon={<Tag size={16} />} title={t('extension.copy.version')} end={!live ? t('extension.copy.interactiveDemo') : offerUpdate
        ? <span className={s.versionEnd}>{version() ?? '—'}<Button size="sm" variant="primary" loading={update.busy} loadingLabel={t('extension.copy.updateChecking')} onClick={() => void update.run()}>{update.ready ? t('extension.copy.updateTo', { version: update.ready }) : t('extension.copy.update')}</Button></span>
        : version() ?? '—'} />
    </SettingGroup>
    {live && <SettingGroup>
      <SettingItem icon={copied ? <Check size={16} /> : <ClipboardCopy size={16} />} title={copied ? t('extension.copy.copied') : t('extension.center.diagnostics')} end={null} onClick={() => void copyDiagnostics()} />
      <SettingItem icon={<Signpost size={16} />} title={t('extension.tour.replay')} onClick={() => void replayTour()} />
    </SettingGroup>}
    <SettingGroup>
      {website && links.map(([path, label, icon]) => <SettingItem key={path} icon={icon} title={label} href={`${website}${path}`} />)}
      <SettingItem icon={<Code size={16} />} title={t('extension.copy.aboutSource')} href={PUBLIC_LINKS.repository} />
    </SettingGroup>
  </>;
}
