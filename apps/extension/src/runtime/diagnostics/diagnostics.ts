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

export type RuntimeDiagnostics = {
  connection: Connection;
  sync: string | null;
  sseOpen: boolean;
  teams: number;
  errors: ErrorCode[];
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
    `SSE open: ${input.sseOpen === true}`,
    `Access tabs: ${input.access.tabs === true}`,
    `Access site: ${input.access.site === true}`,
    `Page layer enabled: ${input.pageLayer.enabled === true}`,
    `Page layer registered: ${input.pageLayer.registered === true}`,
    `Teams: ${input.teams}`,
    'Errors:',
  ];
  for (const error of input.errors) {
    lines.push(`${new Date(error.at).toISOString()} ${error.code}`);
  }
  return { text: lines.join('\n') };
}
