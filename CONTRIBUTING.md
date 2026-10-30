# Contributing to Palside

Issues and pull requests are welcome.

## How changes land

Palside is developed in a private repository that also holds the service, website and operator tools. This repository is exported from it once per Chrome Web Store release, with the same paths, so each commit here is exactly one released version.

When a pull request is accepted, a maintainer applies it in the development repository as a commit authored by you. The release commit that contains it lists you as a co-author, and the pull request is closed with the release version. Pull requests are not merged here directly, because the next export would replace them.

## Setup

Use the Node.js version in [`.node-version`](.node-version) and the npm version pinned in [`package.json`](package.json). Install from the root lockfile; do not create workspace lockfiles.

```sh
npm ci
npm run dev:extension
```

See the [README](README.md) for loading the extension and the integration review pages.

## Code rules

- The background service worker owns Chrome permissions and storage writes; a single offscreen document owns Matrix crypto and wallet controllers; the side panel is UI; the page layer and image entrypoints stay scoped. `tests/extension-boundaries.test.mjs` enforces which layers may import which.
- Domain code stays host-neutral. `packages/ui` is domain-neutral and takes translated props; `packages/design` supplies tokens, motion and fonts; `packages/shared` owns models and wire contracts.
- Permission, CSP, entrypoint and resource allowlist changes go through `scripts/lib/extension-artifact.mjs` and need testing in real Chrome, not only a fixture.
- Never show what the extension cannot prove (sent, online, paid, saved); unknown stays pending.
- Update both `en` and `zh-CN` in `packages/i18n` for user-facing text. Use **squad** in English product text and **小队** in Chinese; keep internal `team` identifiers unchanged.

## Before opening a pull request

```sh
npm run check
```

Run a single test with `node --experimental-strip-types --test tests/<file>.test.mjs`. Contract changes also need `forge test --root contracts` and `npm run chain:generate`.

Explain the change, the commands you ran and anything you could not verify. Attach redacted screenshots for UI changes. Never commit or attach recovery phrases, keys, tokens, environment files or chat content.

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).
