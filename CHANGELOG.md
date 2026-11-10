# Changelog

Each version matches a Chrome Web Store release. The GitHub release attaches the exact store package with its build provenance.

## v0.1.4

- **Shared drawing on charts**: draw on TradingView charts (including DEX Screener) and share your lines with your squad, with a laser pointer for quick marks. A chat note jumps to the line.
- **Follow, rebuilt**: following a teammate opens a tab group named after them that mirrors their tabs and scroll position, and pauses as soon as you take over.
- **Signals stay in chat**: click one to open the page and replay it in place.
- **Shared viewing shares pages**: each page gets its own card with its title and a clean link; pages with sign-in details or an email in the title share only the site name.
- **Page interactions settings**: one master switch on top, and a card each for live comments, signals and shared drawing.
- **Members** are listed by status: active, away, then offline.
- **Automatic updates**: the extension updates itself while the side panel is closed, or in one click from the ⋯ menu or About.
- **More reliable connection**: a single live connection that reconnects faster when the network comes back or the service restarts.
- Sticky notes and quoting a page into chat were removed; signals and shared drawing cover those uses.
- Fixed signals and shared viewing for members whose clock is off, emoji cut in half in captions, and token names flashing "unrecognized" while loading.

Requires desktop Chrome 130 or later. The first time you follow, Palside asks once for the optional tab groups permission to name the group; follow works without it.

在 TradingView 图表（含 DEX Screener）上画线并共享给小队，带激光笔，聊天提示可跳到那条线；跟看重做，用队友名字命名的标签页组同步对方的标签页与滚动位置，自己操作即暂停；信号长期留在聊天里，点开即打开网页并在原处重放；共享在看共享的是网页，每个网页一张卡片，带标题和去追踪参数的链接，含登录凭证或邮箱的网页只共享站名；网页互动设置为页头总开关加弹幕、信号、共享画线三张功能卡；成员按活跃、离开、离线排序；扩展自动更新，也可在 ⋯ 菜单或关于页一键更新；实时连接合并为一条，网络恢复或服务重启后更快重连；移除便利贴与引用到聊天；修复成员时钟偏差导致的信号与共享在看问题、文字中 emoji 被截断、代币加载时闪现“未识别”。需要桌面版 Chrome 130 或更高版本；第一次跟看时询问一次可选的标签页组权限，用于给组命名，不允许也能跟看。

## v0.1.3

- **Tokens on several chains**: when one contract address exists on more than one chain, a chain tag next to the token name lets you switch, and live comments follow the chain you pick.
- **Paste a contract address in chat** and it becomes a token card, like a pasted link.
- **Search in Hot**: find a token by name or contract address; the empty live comments view lists the tokens you viewed recently.
- **Website cards** share the token card layout, with an Open button.
- **Sentiment polls** show headcounts from the first vote, and each commenter's stance appears next to their name.
- **Signals and shared viewing**: shared viewing is faster, signals reach background tabs showing the same page, and signals for other pages appear in chat.
- Fixed missing site icons and live comments across several windows.

Requires desktop Chrome 130 or later.

同一合约地址在多条链上时，代币名旁的链标签可切换，弹幕跟随所选链；聊天中粘贴合约地址生成代币卡片；热门支持按名称或合约地址搜索，弹幕空状态显示最近看过；网站卡片与代币卡片统一并带“打开”按钮；看法从第一票起显示人数，弹幕作者旁显示其看法；共享在看更快，信号可到达同页面的后台标签页，其他页面的信号在聊天中提示；修复网站图标缺失与多窗口弹幕问题。需要桌面版 Chrome 130 或更高版本。

## v0.1.2

- **Token names and icons from Palside's token directory**: the server reads names and icons from the chain (with an image service as a second source) and caches them, so every surface shows the same token. Pool pages and contract pages without a chain in the URL are recognized too, across more crypto sites. The extension itself still calls no token data service or RPC, and names or icons inside shared content are ignored.
- **Faster first view**: the name shows as soon as it is read and the icon is pushed in when it lands; while either is on its way, the token face and name show a quiet loading sweep instead of a question mark.
- **Welcome page and first-run tour** after install, with a live demo of page interactions.
- **Sign-up progress**: real phases while the account is created, ending in a confirmed state.
- **Chat**: messages sent in a burst keep their order; refined send and menu animations.
- Live comments take a viewport band (1/4 up to full screen).

Requires desktop Chrome 130 or later.

代币名称与图标改由 Palside 代币目录提供：服务端读链（图片服务作为第二来源）并缓存，所有位置显示一致；交易池页面和网址不含链的合约页面也能识别，支持更多加密网站。扩展本身仍不调用代币资料服务或 RPC，分享内容自带的名称与图标一律忽略。首次查看时名称读到即显示，图标到达后推送补上，等待期间头像与名称显示扫光而不是问号。安装后打开欢迎页与首次引导；注册显示真实进度；连发消息保持顺序；弹幕可选显示区域。需要桌面版 Chrome 130 或更高版本。

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
