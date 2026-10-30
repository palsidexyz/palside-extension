import { type Infer } from '../validation.ts';
import { adminCasePage } from './cases.ts';
import { adminAccountPage, adminTeamPage } from './entities.ts';
import { adminOrderPage, adminPacketPage } from './ledger.ts';
import { adminWordPage } from './words.ts';
import { adminJobPage } from './health.ts';
import { adminAuditPage } from './audit.ts';

// Lists. Every resource validates `sort` against its own column set; `facets` counts rows per status under the same filters except `status`.
export const adminResources = ['cases', 'accounts', 'teams', 'orders', 'packets', 'words', 'jobs', 'audit'] as const;
export type AdminResource = typeof adminResources[number];
export const adminPages = { cases: adminCasePage, accounts: adminAccountPage, teams: adminTeamPage, orders: adminOrderPage, packets: adminPacketPage, words: adminWordPage, jobs: adminJobPage, audit: adminAuditPage } as const;
export type AdminRow<R extends AdminResource> = Infer<typeof adminPages[R]>['items'][number];
export type AdminPage<R extends AdminResource> = Infer<typeof adminPages[R]>;
/** CSV export uses the list filters without paging (at most 10000 rows). */
export const adminExportResources = ['accounts', 'teams', 'orders', 'audit'] as const;
