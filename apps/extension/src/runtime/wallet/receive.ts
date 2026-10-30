import { getAddress, isAddress, zeroAddress } from 'viem';
import { chainAmount } from '@palside/shared/chain/rules';
import type { ChainDeployment } from '@palside/shared/contracts/chain';

export function walletAddress(value: string): `0x${string}` {
  const address = value.replace(/\s/g, '');
  if (!isAddress(address) || address.toLowerCase() === zeroAddress) throw new Error('INVALID_ADDRESS');
  return getAddress(address);
}
export function receiveRequest(address: string, deployment?: Pick<ChainDeployment, 'chainId' | 'token'>, amount?: string): string {
  const recipient = walletAddress(address);
  if (amount === undefined) return recipient;
  if (!deployment || chainAmount(amount) <= 0n) throw new Error('INVALID_AMOUNT');
  return `ethereum:${walletAddress(deployment.token)}@${deployment.chainId}/transfer?address=${recipient}&uint256=${amount}`;
}
export function checkTransferAddress(value: string, self: string, deployment: ChainDeployment) {
  const address = walletAddress(value), lower = address.toLowerCase();
  if (lower === self.toLowerCase()) throw new Error('SELF_TRANSFER');
  if ([deployment.token, deployment.packetContract].some(contract => contract.toLowerCase() === lower)) throw new Error('CONTRACT_RECIPIENT');
}
