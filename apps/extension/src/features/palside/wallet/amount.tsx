'use client';
import NumberFlow from '@number-flow/react';
import { Counter } from '@palside/ui/counter';

export function formatPals(value: string, decimals = 18) {
  const amount = BigInt(value), unit = 10n ** BigInt(decimals);
  const fraction = (amount % unit).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${amount / unit}${fraction ? `.${fraction}` : ''}`;
}
/** Thousands separators on the whole part, matching the rolling counters (en-US grouping). */
export function groupPals(text: string) {
  const [whole, fraction] = text.split('.');
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`;
}
export function PalsAmount({ value, decimals = 18, hidden = false, price }: { value?: string; decimals?: number; hidden?: boolean; price?: { numerator: string; denominator: string } | null }) {
  if (hidden) return <span aria-label="••••">••••</span>;
  if (value === undefined) return <span>—</span>;
  const text = formatPals(value, decimals);
  const whole = BigInt(value) / 10n ** BigInt(decimals);
  const cents = price && BigInt(price.denominator) > 0n ? BigInt(value) * BigInt(price.numerator) * 100n / (10n ** BigInt(decimals) * BigInt(price.denominator)) : undefined;
  // NumberFlow receives only exactly representable display integers; amounts stay bigint everywhere else.
  return <span title={`${text} PALS`}>{whole <= BigInt(Number.MAX_SAFE_INTEGER) && !text.includes('.') ? <Counter value={Number(whole)} /> : text}<small> PALS</small>{cents !== undefined && <small> ≈ ${cents / 100n}.{(cents % 100n).toString().padStart(2, '0')}</small>}</span>;
}

export function AnimatedAmount({ value, decimals = 18, minimumFractionDigits = 0, maximumFractionDigits = 4, prefix = '' }: { value: string; decimals?: number; minimumFractionDigits?: number; maximumFractionDigits?: number; prefix?: string }) {
  const amount = BigInt(value), precision = Math.min(decimals, maximumFractionDigits);
  const divisor = 10n ** BigInt(decimals - precision), scaled = (amount + divisor / 2n) / divisor;
  const number = scaled <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(scaled) / 10 ** precision : undefined;
  const exact = precision ? `${scaled / 10n ** BigInt(precision)}.${(scaled % 10n ** BigInt(precision)).toString().padStart(precision, '0')}` : scaled.toString();
  return number !== undefined && number.toFixed(precision) === exact ? <NumberFlow value={number} prefix={prefix} locales="en-US" format={{ minimumFractionDigits, maximumFractionDigits }} /> : <>{prefix}{formatPals(value, decimals)}</>;
}
