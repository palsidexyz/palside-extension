'use client';
import { useCallback,useState } from 'react';
import { useTranslations } from 'use-intl';
import type { TextValue } from '@palside/i18n';
export function useText() {
  const t = useTranslations();
  return useCallback((value: TextValue | undefined): string => typeof value === 'string' ? value : value ? t(value.key, value.values) : '', [t]);
}
export function useTextState() {
  const [value, setValue] = useState<TextValue>('');
  const text = useText();
  return [text(value), setValue] as const;
}
