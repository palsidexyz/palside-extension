import { siteById } from '@palside/shared/sites';
import type { Preferences } from '../../domain/account/preferences';
import type { RuntimeState } from './runtime-state';
import { startedTeams } from '../teams/onboarding';
import { readFavorites,readSiteInteractions } from '../../domain/annotations/interaction';

export const SNAPSHOT_INTERVAL = 15_000;
export const READ_FLUSH_DELAY = 1_500;

export function defaultPreferences(): Preferences {
  return {
    current: '',
    notifications: 'off',
  };
}

type PreferencePatch = Pick<Preferences, 'current' | 'forgottenTeams' | 'notificationPreview' | 'notifications' | 'share' | 'siteInteraction' | 'favorites' | 'rooms' | 'toured'>;
const preferenceFields = ['current', 'forgottenTeams', 'notificationPreview', 'notifications', 'share', 'siteInteraction', 'favorites', 'rooms', 'toured'] as const;

/** Only these user-editable fields may be patched; policy and onboarding have their own writers. */
export function readPreferencePatch(input: Record<string, unknown>): Partial<PreferencePatch> | undefined {
  const patch: Partial<PreferencePatch> = {};
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'accountId':
      case 'startedTeams': break;
      case 'current':
        if (typeof value !== 'string') return;
        patch.current = value; break;
      case 'forgottenTeams':
        if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) return;
        patch[key] = [...new Set((value as string[]).toReversed())].slice(0, 500).reverse(); break;
      case 'notificationPreview':
      case 'share':
      case 'toured':
        if (typeof value !== 'boolean') return;
        patch[key] = value; break;
      case 'notifications':
        if (value !== 'off' && value !== 'mentions' && value !== 'all') return;
        patch.notifications = value; break;
      case 'rooms': {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, item]) => key === 'off' || key === 'noticed' ? typeof item !== 'boolean' : key !== 'site' || typeof item !== 'string' || !siteById(item))) return;
        patch.rooms = { ...value }; break;
      }
      case 'siteInteraction': {
        const sites = readSiteInteractions(value);
        if (!sites) return;
        patch.siteInteraction = sites; break;
      }
      case 'favorites': {
        const favorites = readFavorites(value);
        if (!favorites) return;
        patch.favorites = favorites; break;
      }
      default: return;
    }
  }
  return patch;
}

/** Restore only validated preference fields. */
export function readPreferences(input: unknown): Preferences {
  const preferences = defaultPreferences();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return preferences;
  const record = input as Record<string, unknown>;
  for (const field of preferenceFields) {
    if (Object.hasOwn(record, field)) Object.assign(preferences, readPreferencePatch({ [field]: record[field] }));
  }
  preferences.startedTeams = startedTeams(record.startedTeams);
  return preferences;
}

export function emptyState(): RuntimeState {
  return {
    rooms: { summaries: {}, blocked: [], invites: [], acceptInvites: true, avatars: {} },
    revision: 0,
    ready: false,
    authenticated: false,
    connection: {
      networkOnline: globalThis.navigator?.onLine !== false,
      service: 'connecting',
      messaging: 'connecting',
      retrying: false,
    },
    data: {
      self: '',
      people: [],
      teams: [],
      views: [],
      messages: [],
      requests: [],
    },
    drafts: {},
    preferences: defaultPreferences(),
    remoteTeams: [],
    lobbyTeams: [],
    config: {
      websiteUrl: '',
      signupDifficulty: 0,
    },
    invitations: {},
  };
}

export const silent = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  getChild() {
    return this;
  },
};

export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const colors = ['#e7e5f4', '#e5eedc', '#f7e4d8', '#dcebee'];

export function color(id: string): string {
  const sum = [...id].reduce((total, character) => total + character.charCodeAt(0), 0);
  return colors[sum % colors.length] ?? colors[0]!;
}
