export type Viewing = {
  version?: 1;
  disclosure?: 'site' | 'page';
  id: string;
  name: string;
  kind: 'asset' | 'website';
  source: string;
  url: string;
  chain?: string;
  address?: string;
  color: string;
  glyph: string;
  logo?: string;
  /** A token page whose URL names a pool (`pool`) or a contract without its chain (`address`): the token was found by the server. */
  via?: 'pool' | 'address';
};
