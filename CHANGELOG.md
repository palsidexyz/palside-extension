# Changelog

Each version matches a Chrome Web Store release. The GitHub release attaches the exact store package with its build provenance.

## v0.1.1

The first Chrome Web Store build.

- **Chat and live comments in one place**: the side panel now has Chat and Live comments tabs, and the site switcher sits on the header.
- **Recovery phrase sign-in**: fixed a hang after the recovery phrase was verified.
- **Reworked limits**: message retention, invites and squad rules follow one shared set of parameters.
- **Hardening**: stricter extension page CSP, and page resources use dynamic URLs so sites cannot detect the extension.
- Notifications use a new toast component.

Requires desktop Chrome 130 or later.

首个上架 Chrome 应用商店的版本：侧栏分为“聊天｜弹幕”两个标签，网站切换移到顶栏；修复验证助记词后卡住的问题；消息保留、邀请和小队规则统一按新参数执行；加强扩展页面 CSP，网页资源改用动态地址，网站无法探测扩展。需要桌面版 Chrome 130 或更高版本。

## v0.1.0

The first public release of the Palside Chrome extension and its contracts.

- **Squad watching**: see the tokens your squad has open, live in the side panel.
- **Chart signals**: mark a spot on the chart and everyone on the page sees it.
- **Live token comments**: one comment stream per token, shown on the page.
- **Encrypted squad chat**: end-to-end encrypted with Matrix Olm/Megolm; keys stay on your devices.
- **Page notes and captures**: sticky notes anchored to text, and annotated screenshots with Alt+Shift+S.
- **PALS red packets**: send PALS in chat from a wallet that signs locally.

Requires desktop Chrome 130 or later.

首个公开版本，包含 Palside Chrome 扩展与合约源代码：小队在看、图表信号、代币弹幕、端到端加密的小队聊天、网页便利贴与截图标注，以及在本机签名的 PALS 红包。需要桌面版 Chrome 130 或更高版本。
