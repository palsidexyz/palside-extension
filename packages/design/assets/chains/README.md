# Chain logos

Each logo comes from the chain's official brand page. The source page, download URL, archive path and SHA-256 are recorded in `sources.json`; raster sources also record the original file name and `sourceSha256`. Logos are used only to identify a chain and do not imply partnership or endorsement. Trademarks and artwork belong to their owners and are not covered by the Palside license.

| Chain | Runtime file | Source |
| --- | --- | --- |
| Robinhood Chain | `robinhood.webp` (1,810 bytes) | Feather Symbol on fluorescent green, from the official brand pack |
| Solana, BNB Chain, Ethereum | `solana.svg`, `bnb.svg`, `ethereum.svg` | Standalone mark SVGs from the official brand pages |
| Base | `base.webp` (138 bytes) | App icon from the official brand site |

Raster logos are resized proportionally to 96×96 lossless WebP; SVGs are kept as published. The five runtime files total 6,013 bytes (originals 96,719 bytes). Logos are never redrawn, recolored or cropped.

On a token avatar, the chain badge, its frame and offset scale with the avatar; in the network picker the logo is 20px. Unknown chains fall back to a generic network icon and the raw chain name rather than guessing.

[`scripts/sync-site-assets.mjs`](../../../../scripts/sync-site-assets.mjs) copies the files to each host's `public/chain-logos/` according to the [host allowlist](../../../../scripts/lib/site-assets.mjs), and the artifact check compares runtime hashes.
