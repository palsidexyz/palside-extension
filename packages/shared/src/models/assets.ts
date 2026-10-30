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
};
