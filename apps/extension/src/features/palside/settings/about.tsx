'use client';
import { message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { useState } from 'react';
import { Check, ClipboardCopy, Code, FileText, Globe, ShieldCheck, Tag } from 'lucide-react';
import { browser } from 'wxt/browser';
import { PUBLIC_LINKS } from '@palside/shared/public-links';
import { Brand } from '../ui/brand';
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

/** 关于: version, links, and a one-click copy of what support needs to see. */
export function About({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const live = c.live;
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
  const links = [['', t('extension.copy.aboutWebsite'), <Globe key="" size={16} />], ['/privacy', t('extension.copy.aboutPrivacy'), <ShieldCheck key="" size={16} />], ['/terms', t('extension.copy.aboutTerms'), <FileText key="" size={16} />]] as const;
  return <>
    <div className={s.aboutHero}><Brand /><p>{t('extension.copy.exploreWithFriends')}</p></div>
    <SettingGroup>
      <SettingItem icon={<Tag size={16} />} title={t('extension.copy.version')} end={live ? version() ?? '—' : t('extension.copy.interactiveDemo')} />
    </SettingGroup>
    {live && <SettingGroup>
      <SettingItem icon={copied ? <Check size={16} /> : <ClipboardCopy size={16} />} title={copied ? t('extension.copy.copied') : t('extension.center.diagnostics')} end={null} onClick={() => void copyDiagnostics()} />
    </SettingGroup>}
    <SettingGroup>
      {website && links.map(([path, label, icon]) => <SettingItem key={path} icon={icon} title={label} href={`${website}${path}`} />)}
      <SettingItem icon={<Code size={16} />} title={t('extension.copy.aboutSource')} href={PUBLIC_LINKS.repository} />
    </SettingGroup>
    <p className={s.aboutNotice}>{t('extension.copy.thirdPartyLogos', { email: PUBLIC_LINKS.contactEmail })}</p>
  </>;
}
