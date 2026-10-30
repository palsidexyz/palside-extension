import Type from 'typebox';
import { strictObject, type Infer } from '../validation.ts';
import { chainConfig, chainDeployment, chainAmount } from '../chain.ts';
import { nullable, text } from './common.ts';

const count = Type.Integer({ minimum: 0 });
export const adminChainDraft = strictObject({ ...Type.Omit(chainConfig, ['version', 'updatedAt']).properties, testers: Type.Array(chainConfig.properties.testers.items, { maxItems: 50, uniqueItems: true }) });
export const adminChainConfigChange = strictObject({ expectedVersion: chainConfig.properties.version, draft: adminChainDraft, reason: text });
export const adminChainEnabledChange = strictObject({ expectedVersion: chainConfig.properties.version, enabled: Type.Boolean(), reason: text });
export const adminChainConfigChangeResult = strictObject({ config: chainConfig });
export type AdminChainConfigChange = Infer<typeof adminChainConfigChange>;
export type AdminChainEnabledChange = Infer<typeof adminChainEnabledChange>;
export const adminRelayStates = ['preparing', 'prepared', 'submitting', 'uncertain', 'submitted', 'included', 'confirmed', 'failed', 'expired', 'cancelled'] as const;
export const adminChainStatus = strictObject({
  checkedAt: Type.Integer(),
  config: nullable(chainConfig),
  tasks: nullable(strictObject({ pending: count, submitted: count, complete: count, unfinished: count, attemptedUnfinished: count })),
  sponsorship: nullable(strictObject({
    day: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), timezone: Type.Literal('Asia/Taipei'), scope: Type.Literal('all-accounts'), basis: Type.Literal('reservation-day'), includesAutomation: Type.Literal(false),
    perAccountDailyLimit: nullable(chainConfig.properties.dailySponsoredLimit), quotaCommitted: count,
    byState: strictObject({ preparing: count, prepared: count, submitting: count, uncertain: count, submitted: count, included: count, confirmed: count, failed: count, expired: count, cancelled: count }),
  })),
  failures: Type.Array(strictObject({ section: Type.Enum(['config', 'tasks', 'sponsorship']), reason: Type.Enum(['not-configured', 'read-failed']) })),
});
export type AdminChainStatus = Infer<typeof adminChainStatus>;
export const adminChainWarning = Type.Enum(['TOKEN_UNREADABLE', 'DECIMALS_MISMATCH', 'PACKET_CONTRACT_UNREADABLE', 'SIGNER_MISMATCH', 'INDEX_MISMATCH', 'OPEN_PACKETS_ON_PREVIOUS_CONTRACT', 'RPC_UNAVAILABLE']);
const inspectionFindings = strictObject({
  facts: strictObject({ name: nullable(Type.String()), symbol: nullable(Type.String()), decimals: nullable(Type.Integer()), totalSupply: nullable(chainAmount), claimSigner: nullable(Type.String()), openPacketsOnPrevious: count }),
  warnings: Type.Array(adminChainWarning),
});
// The chain port supplies findings; the admin response identifies the requested draft separately.
export type AdminChainInspection = Infer<typeof inspectionFindings>;
export const adminChainInspection = strictObject({
  ...inspectionFindings.properties,
  deployment: nullable(chainDeployment), chainId: nullable(chainDeployment.properties.chainId), checkedAt: Type.Integer(), blockNumber: nullable(chainAmount),
  state: Type.Enum(['not-deployed', 'complete', 'partial', 'unavailable']),
});
export type AdminChainInspectionResult = Infer<typeof adminChainInspection>;
