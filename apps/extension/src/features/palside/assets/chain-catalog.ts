export const chains = [
  { value: 'Robinhood', label: 'Robinhood Chain', logo: '/chain-logos/robinhood.webp' },
  { value: 'Solana', label: 'Solana', logo: '/chain-logos/solana.svg' },
  { value: 'BNB Chain', label: 'BNB Chain', logo: '/chain-logos/bnb.svg' },
  { value: 'Ethereum', label: 'Ethereum', logo: '/chain-logos/ethereum.svg' },
  { value: 'Base', label: 'Base', logo: '/chain-logos/base.webp' },
] as const;

export function chainInfo(value?: string) { return chains.find(chain => chain.value === value || chain.label === value); }
