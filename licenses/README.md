# Third-party sources and notices

The Palside code is licensed under [MIT](../LICENSE). The name and logo are covered by [TRADEMARKS.md](../TRADEMARKS.md). Everything below keeps its own terms.

## npm packages

`scripts/third-party-licenses.mjs` generates `THIRD-PARTY.txt` and `THIRD-PARTY.json` from the lockfile and the verified license texts in [`scripts/licenses/`](../scripts/licenses/). Every extension build writes them, with the project MIT notice and the font OFL notices, to `apps/extension/.output/chrome-mv3/licenses/`. The generated files are not tracked. `npm run check:licenses` confirms they are complete.

## Assets

| Asset | Source records |
| --- | --- |
| Signal sounds | [`signal-sounds/sources.json`](signal-sounds/sources.json): provenance and SHA-256 for all 54 recordings in [`tooling/signal-sounds/sources/`](../tooling/signal-sounds/sources/), with each pack's license text stored once in [`signal-sounds/`](signal-sounds/) |
| Signal rendering code | [`apps/extension/public/signals/LICENSE`](../apps/extension/public/signals/LICENSE): MIT notice for the adapted wheel, ping and emote renderer |
| Fonts | [`packages/design/fonts/`](../packages/design/fonts/): font files and OFL notices |
| Site logos | [`packages/design/assets/sites/sources.json`](../packages/design/assets/sites/sources.json) |
| Chain logos | [`packages/design/assets/chains/sources.json`](../packages/design/assets/chains/sources.json) |
| Token images | [`packages/design/assets/tokens/sources.json`](../packages/design/assets/tokens/sources.json) |
| Avatars, squad avatars and artwork | `sources.json` in [`avatars/`](../packages/design/assets/avatars/), [`team-avatars/`](../packages/design/assets/team-avatars/) and [`art/`](../packages/design/assets/art/) under `packages/design/assets/` |

Site, chain and token logos belong to their owners and are included only to identify those sites and assets.

`scripts/sync-site-assets.mjs` copies these assets into the extension's `public/` folder before each build and generates the Chrome icons from [`packages/design/assets/brand/`](../packages/design/assets/brand/).
