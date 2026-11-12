import { getAddress } from 'viem';

/** The account ID people see is the 零钱 address in EIP-55 case, as MetaMask shows it, so one mistyped letter fails the checksum. */
export function accountAddress(address: string) { return getAddress(address.toLowerCase()); }
/** `0xAbCd…1234`: the short account ID on cards and rows. */
export function shortAccountAddress(address: string) { const value = accountAddress(address); return `${value.slice(0, 6)}…${value.slice(-4)}`; }
