import { MINUTE_MS } from '@palside/shared/units';
import type { Connection } from '../transport/connection';

type ErrorCode = { code: string; at: number };

export class DiagnosticErrors {
  private entries: ErrorCode[] = [];
  private observed = new Map<string, unknown>();

  record(value: unknown, at = Date.now()): void {
    if (!value || typeof value !== 'object') return;
    const candidate = value as { code?: unknown; errcode?: unknown; key?: unknown; text?: unknown };
    const code = candidate.code ?? candidate.errcode ?? candidate.key;
    if (typeof code !== 'string') {
      if (candidate.text) this.record(candidate.text, at);
      return;
    }
    if (!/^(?:[A-Z][A-Z0-9_]{1,63}|extension\.(?:runtime|copy)\.[a-zA-Z0-9]+|common\.error)$/.test(code)) return;
    this.entries.push({ code, at });
    this.entries = this.entries.slice(-10);
  }

  observe(slot: string, value: unknown): void {
    if (this.observed.get(slot) === value) return;
    this.observed.set(slot, value);
    this.record(value);
  }

  snapshot(): ErrorCode[] {
    return this.entries.map(entry => ({ ...entry }));
  }
}

/** Channels whose arrival delay is measured on the receiving device. */
export type LatencyChannel = 'viewing' | 'signal' | 'danmaku' | 'message';
type LatencySummary = Partial<Record<LatencyChannel, { count: number; median: number; p90: number }>>;

/**
 * Arrival delay per realtime channel: receive time minus the sender's (or server's) timestamp, last 20 samples each.
 * It includes the clock difference between the two machines, so it is a comparison between channels, not an exact figure.
 */
export class DiagnosticLatency {
  private samples = new Map<LatencyChannel, number[]>();
  record(channel: LatencyChannel, sentAt: unknown, now = Date.now()) {
    if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) return;
    const delay = now - sentAt;
    if (Math.abs(delay) > MINUTE_MS) return;
    const list = this.samples.get(channel) ?? [];
    list.push(delay); this.samples.set(channel, list.slice(-20));
  }
  snapshot(): LatencySummary {
    const summary: LatencySummary = {};
    for (const [channel, list] of this.samples) {
      const sorted = [...list].sort((a, b) => a - b), at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
      summary[channel] = { count: sorted.length, median: at(0.5), p90: at(0.9) };
    }
    return summary;
  }
}

export type RuntimeDiagnostics = {
  connection: Connection;
  sync: string | null;
  liveOpen: boolean;
  teams: number;
  errors: ErrorCode[];
  latency: LatencySummary;
};

type DiagnosticsInput = RuntimeDiagnostics & {
  version: string;
  ua: string;
  locale: string;
  access: { tabs: boolean; site: boolean };
  pageLayer: { enabled: boolean; registered: boolean };
};

const lineValue = (value: string) => value.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').slice(0, 512);

/** Explicit scalar fields only: never serialize runtime state or error objects. */
export function diagnostics(input: DiagnosticsInput): { text: string } {
  const connection = input.connection;
  const lines = [
    `Extension: ${lineValue(input.version)}`,
    `Browser UA: ${lineValue(input.ua)}`,
    `Locale: ${lineValue(input.locale)}`,
    `Network online: ${connection.networkOnline === true}`,
    `Service: ${lineValue(connection.service)}`,
    `Messaging: ${lineValue(connection.messaging)}`,
    `Retrying: ${connection.retrying === true}`,
    `Sync: ${lineValue(input.sync ?? 'STOPPED')}`,
    `Live socket open: ${input.liveOpen === true}`,
    `Access tabs: ${input.access.tabs === true}`,
    `Access site: ${input.access.site === true}`,
    `Page layer enabled: ${input.pageLayer.enabled === true}`,
    `Page layer registered: ${input.pageLayer.registered === true}`,
    `Teams: ${input.teams}`,
  ];
  const latency = Object.entries(input.latency ?? {});
  if (latency.length) {
    lines.push('Latency (median / p90 ms, includes clock difference):');
    for (const [channel, value] of latency) lines.push(`  ${channel}: ${value.median} / ${value.p90} (${value.count})`);
  }
  lines.push('Errors:');
  for (const error of input.errors) {
    lines.push(`${new Date(error.at).toISOString()} ${error.code}`);
  }
  return { text: lines.join('\n') };
}
