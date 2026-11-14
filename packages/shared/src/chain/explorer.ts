/** The public block explorer page for an address or transaction; undefined for a chain without one (local 31337) or a malformed value. */
export function explorerLink(chainId: number, kind: 'address' | 'tx', value: string) {
  if (chainId !== 4663 || !(kind === 'address' ? /^0x[0-9a-fA-F]{40}$/ : /^0x[0-9a-fA-F]{64}$/).test(value)) return undefined;
  return `https://robin.etherscan.io/${kind}/${value}`;
}
