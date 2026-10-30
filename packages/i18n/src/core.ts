import { createTranslator, type AbstractIntlMessages } from 'use-intl/core';
import { PUBLIC_LINKS } from '@palside/shared/public-links';
import en from './en.json' with { type: 'json' };
import zh from './zh-CN.json' with { type: 'json' };
import { localeOrEnglish, type Locale } from './locale.ts';
export * from './locale.ts';
export type TextMessage = { key: string; values?: Record<string, string | number> };
export function message(key: string, values?: TextMessage['values']): TextMessage { return values ? { key, values } : { key }; }
function withFallback(base: AbstractIntlMessages, translated: AbstractIntlMessages): AbstractIntlMessages {
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, typeof value === 'string' ? translated[key] ?? value : withFallback(value, typeof translated[key] === 'object' ? translated[key] : {})]));
}
const dictionaries: Record<Locale, AbstractIntlMessages> = { en, 'zh-CN': withFallback(en, zh) };
export function messagesFor(locale: unknown) { return dictionaries[localeOrEnglish(locale)]; }
export function translator(locale: unknown) {
  const language = localeOrEnglish(locale);
  return createTranslator({ locale: language, messages: messagesFor(language), onError(error) { console.error('[i18n]', error.code); }, getMessageFallback() { return language === 'zh-CN' ? zh.common.error : en.common.error; } }) as (key: string, values?: TextMessage['values']) => string;
}
export function renderMessage(locale: unknown, value: TextMessage) { return translator(locale)(value.key, value.values); }
/** The one short date and time: 10月20日 22:00 / Oct 20, 22:00, with the year only when it is not this year. */
function shortDateTime(date: Date, locale: Locale, now: number) {
  return new Intl.DateTimeFormat(locale, { ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }), month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}
/** A list clock: today as 24 hour time, earlier days as the short date and time. */
export function chatTime(timestamp: number | undefined, locale: Locale, now = Date.now()) {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  if (date.toDateString() !== new Date(now).toDateString()) return shortDateTime(date, locale, now);
  return clockTime(timestamp, locale);
}
/** Only the time of day, 24-hour: where a date label above already says which day. */
export function clockTime(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp));
}
/** A past moment: 刚刚 / 3分钟前 / 3m ago within the hour, otherwise the short date and time. */
export function pastTime(timestamp: number, locale: Locale, now = Date.now()) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 0 || minutes >= 60) return shortDateTime(date, locale, now);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
  return minutes === 0 ? translator(locale)('common.justNow') : relative.format(-minutes, 'minute');
}
/** A deadline as 今天 / 明天 / 周五 plus 24 hour time within the coming week; later or past ones keep month and day. */
export function deadlineTime(timestamp: number, locale: Locale, now = Date.now()) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  const midnight = (value: number) => new Date(value).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(timestamp) - midnight(now)) / 86_400_000);
  if (days === 0 || days === 1) return `${new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day')} ${time}`;
  if (days > 1 && days < 7) return `${new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)} ${time}`;
  return shortDateTime(date, locale, now);
}
/** Plain strings carry empty values or user-supplied text; system messages use TextMessage. */
export type TextValue = string | TextMessage;
export class MessageError extends Error {
  readonly text: TextMessage;
  constructor(text: TextMessage) { super(text.key); this.name = 'MessageError'; this.text = text; }
}
const parameterizedErrorCodes = ['RATE_LIMITED_SECONDS', 'RATE_LIMITED_MINUTES', 'RATE_LIMITED_HOURS', 'UPLOAD_QUOTA', 'INVITE_PASSWORD_WRONG', 'INVITE_PASSWORD_LOCKED', 'ACCOUNT_BANNED'] as const satisfies readonly (keyof typeof en.extension.errors)[];
type PlainErrorCode = Exclude<keyof typeof en.extension.errors, typeof parameterizedErrorCodes[number]>;
function isPlainErrorCode(code: string | undefined): code is PlainErrorCode {
  return code !== undefined && Object.hasOwn(en.extension.errors, code) && !parameterizedErrorCodes.some(key => key === code);
}
export function errorMessage(error: unknown): TextMessage {
  if (error && typeof error === 'object') {
    const value = error as { text?: TextMessage; code?: string; retryAfterMs?: number; reason?: string; remaining?: number };
    if (value.text && typeof value.text.key === 'string') return value.text;
    const messages = en.extension.errors;
    const code = value.reason && Object.hasOwn(messages, `${value.code}_${value.reason}`) ? `${value.code}_${value.reason}` : value.code;
    if (code === 'ACCOUNT_BANNED') return message('extension.errors.ACCOUNT_BANNED', { email: PUBLIC_LINKS.contactEmail });
    const wait = typeof value.retryAfterMs === 'number' && Number.isFinite(value.retryAfterMs) && value.retryAfterMs > 0 ? Math.ceil(value.retryAfterMs / 1000) : undefined;
    // Throttling says how long to wait, in the largest whole unit that still reads naturally.
    if (wait && (code === 'RATE_LIMITED' || code === 'UPLOAD_QUOTA')) {
      if (code === 'UPLOAD_QUOTA') return message('extension.errors.UPLOAD_QUOTA', { count: Math.ceil(wait / 3600) });
      return wait < 60 ? message('extension.errors.RATE_LIMITED_SECONDS', { count: wait })
        : wait < 3600 ? message('extension.errors.RATE_LIMITED_MINUTES', { count: Math.ceil(wait / 60) })
        : message('extension.errors.RATE_LIMITED_HOURS', { count: Math.ceil(wait / 3600) });
    }
    // A join password lock lasts at most an hour, so it always reads in minutes.
    if (code === 'INVITE_PASSWORD_LOCKED') return message('extension.errors.INVITE_PASSWORD_LOCKED', { count: Math.max(1, Math.ceil((wait ?? 60) / 60)) });
    if (code === 'INVITE_PASSWORD_WRONG' && typeof value.remaining === 'number' && Number.isFinite(value.remaining)) return message('extension.errors.INVITE_PASSWORD_WRONG', { remaining: value.remaining });
    if (isPlainErrorCode(code)) return message(`extension.errors.${code}`);
  }
  return message('common.error');
}
