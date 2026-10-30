import type { ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import { messagesFor } from '@palside/i18n';
/** Integration fixtures retain their Chinese baseline; ?locale=en exercises the same UI in English. */
export function IntegrationIntl({ children }: { children?: ReactNode }) {
  const locale = new URLSearchParams(location.search).get('locale') === 'en' ? 'en' : 'zh-CN';
  return <IntlProvider timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} locale={locale} messages={messagesFor(locale)}>{children}</IntlProvider>;
}
