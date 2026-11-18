# Changelog

Each version matches a Chrome Web Store release. The GitHub release attaches the exact store package with its build provenance.

## v0.1.11

### What's new

- **New look** — Palside has a new icon: a white P with eyes on a lime tile, in the toolbar, the side panel and on charts.
- **PALS coin** — PALS amounts, transfers and red packets show the new round PALS coin.

### 更新内容

- **新标识** — Palside 换上新图标：柠檬绿方块上的白色 P，带一双眼睛；工具栏、侧边栏和图表上同步更换。
- **PALS 币面** — PALS 金额、转账与红包使用新的圆形 PALS 币面。

## v0.1.10

### What's new

- **Typography** — the side panel and page overlays use one typeface, Geist, with the system's own Chinese font.
- **Site controls** — when Palside is allowed on all websites, sites you turn off don't load its page layer at all.

### 更新内容

- **字体** — 侧边栏与网页浮层统一使用 Geist 字体，中文使用系统字体。
- **网站开关** — 授权「所有网站」时，你关闭的网站完全不加载 Palside 的页面层。

## v0.1.9

### What's new

- **Wallet settings** — the PALS and red packet contracts are listed with their full addresses. Copy either, or open it on Etherscan.
- **Wallet security** — private key export is removed. Your recovery phrase restores the wallet address and its funds.
- **Token list** — a token appears in the wallet only once it is open to your account.

### 更新内容

- **零钱设置** — 列出 PALS 合约与红包合约的完整地址，可复制，也可在 Etherscan 打开。
- **零钱安全** — 移除导出私钥。助记词可恢复零钱地址及其资产。
- **代币列表** — 代币对你的账号开放后，零钱才显示它。

## v0.1.8

### What's new

- **Live comments in the chat area** — the Danmaku key turns the chat area into the token's live comments, with a token card on top and a red bar for packets you can still open. Press it again to return to your squad, right where you left off.
- **Call to look** — the megaphone posts the current page into chat and calls the whole squad; Call to look on a profile calls one teammate. No sharing needed. The card shows who has arrived.
- **Red packets** — a packet shows its sender's name and avatar even if they never commented on the token. After opening one, "Open next" moves to the next packet.
- **Payments** — if free network fees are temporarily unavailable, the payment retries automatically. A payment that was not sent is marked as not charged.
- **Tips** — appear below the comment they were sent to.

### 更新内容

- **弹幕进入聊天区** — 「弹幕」键把聊天区就地换成该代币的弹幕，顶部为代币卡，红包条列出还能领的红包。再按一次回到小队聊天，阅读位置不变。
- **喊来看** — 扩音器把当前页面发到聊天并喊全队；资料卡里的「喊来看」只喊一位队友。不需要先开启共享，卡片显示已经到了的队友。
- **红包** — 即使发送者没在该代币发过言，也显示其名字与头像。领完一个后可「开下一个」。
- **付款** — 免费网络费暂时不可用时自动重试。未发出的付款标明未扣款。
- **打赏** — 显示在对应弹幕下方。

## v0.1.7

### What's new

- **Red packets in live comments** — a red packet sent to a token appears once on the page as a gold comment with a small envelope; click it to open the envelope in the side panel. When a packet is not yet claimable, the envelope shows the time left and the requirement. Slow mode limits text comments only, not red packets.
- **Live comments key** — the Danmaku key next to the message box shows how many people are watching the token. One switch in page interaction settings turns live comments on or off.
- **Call to look** — call a teammate who is active or away, or the whole squad, to the page you are sharing. The call arrives as a desktop notification, following your notification settings, and stays for 5 minutes.
- **Presence** — your own avatar shows your account's real status. Only keyboard and mouse activity counts as active.
- **Message search** — newest results first, with earlier history loaded automatically while you search.
- **Accounts** — after deleting your account, the same recovery phrase can sign up again. Signing in with a phrase that has no account offers to create one with it.

### 更新内容

- **红包进入弹幕** — 发到代币的红包在网页上以金色弹幕加小红信封飘过一次，点击即在侧栏打开信封。暂不可领取时，信封显示剩余时间与领取条件。慢速只限制文字弹幕，不限制红包。
- **弹幕键** — 输入框旁的「弹幕」键显示在看人数。网页互动设置里一个开关统一开关弹幕。
- **喊来看** — 可以喊活跃或离开的队友，也可以喊全队，到你正在共享的网页。以桌面通知送达（遵循通知设置），保留 5 分钟。
- **在线状态** — 自己的头像显示账号真实状态。只有键鼠操作算活跃。
- **搜索消息** — 按最新排序，搜索时自动加载更早的记录。
- **账号** — 注销后同一组助记词可以重新注册。用没有账号的助记词登录时，可直接用它创建账号。

## v0.1.6

### What's new

- **Live comments from the chat box** — the chat and live-comment tabs at the top are gone; a 弹 key next to the message box switches it to sending a live comment on the token you're viewing.
- **Payments show up right away** — transfers and red packets appear in chat the moment you pay, marked as sending until they land on chain, or as failed if the payment did not go through.
- **Red packets** — opening one shows your share in a bottom sheet with a falling-coins effect.

### 更新内容

- **从输入框发弹幕** — 去掉顶部「聊天｜弹幕」切换，输入框旁的「弹」键直接对正在看的代币发弹幕。
- **付款即时显示** — 转账和红包付款后立即出现在聊天里，上链前显示发送中，未成功显示已失败。
- **红包** — 拆红包结果在底部面板展示，并带落币效果。

## v0.1.5

### What's new

- **Your account ID is your wallet address** — member cards, settings and live comments show a short 0x address; click it to copy the full one. The security page shows the full address.
- **View your wallet elsewhere** — the recovery phrase also opens the same address in MetaMask or Trust Wallet.
- **Privacy** — other people's balances are never shown.
- **Live comments** — use the top half of the page by default, and likes share one style.
- **Readability** — tip amounts get thousands separators, and contract addresses copy in one click.
- **Reset** — accounts, squads and messages from earlier versions were reset with this update.

### 更新内容

- **账号 ID 改为你的零钱地址** — 成员卡、设置和弹幕显示缩短的 0x 地址，点一下复制完整地址。安全页显示完整地址。
- **在其他钱包查看** — 用同一组助记词可以在 MetaMask 或 Trust Wallet 中看到同一个地址。
- **隐私** — 从不显示他人余额。
- **弹幕** — 默认占网页上半部分，点赞样式统一。
- **易读性** — 打赏金额加千位分隔，合约地址一键复制。
- **重置** — 本次更新重置了此前的账号、小队和消息。

## v0.1.4

### What's new

- **Shared drawing on charts** — draw on TradingView charts (including DEX Screener) and share your lines with your squad, with a laser pointer for quick marks. A chat note jumps to the line.
- **Follow, rebuilt** — following a teammate opens a tab group named after them that mirrors their tabs and scroll position, and pauses as soon as you take over.
- **Signals stay in chat** — click one to open the page and replay it in place.
- **Shared viewing shares pages** — each page gets its own card with its title and a clean link; pages with sign-in details or an email in the title share only the site name.
- **Page interactions settings** — one master switch on top, and a card each for live comments, signals and shared drawing.
- **Members** — listed by status: active, away, then offline.
- **Automatic updates** — the extension updates itself while the side panel is closed, or in one click from the ⋯ menu or About.
- **More reliable connection** — a single live connection that reconnects faster when the network comes back or the service restarts.
- **Removed** — sticky notes and quoting a page into chat; signals and shared drawing cover those uses.
- **Fixes** — signals and shared viewing for members whose clock is off, emoji cut in half in captions, and token names flashing "unrecognized" while loading.
- **Tab groups** — the first time you follow, Palside asks once for the optional tab groups permission to name the group. Follow works without it.

### 更新内容

- **图表共享画线** — 在 TradingView 图表（含 DEX Screener）上画线并共享给小队，带激光笔用于快速标记。聊天提示可跳到那条线。
- **跟看重做** — 跟看队友时打开以对方名字命名的标签页组，同步对方的标签页与滚动位置，你一操作即暂停。
- **信号留在聊天** — 点开即打开网页并在原处重放。
- **共享在看共享网页** — 每个网页一张卡片，带标题和去追踪参数的链接；含登录凭证或邮箱的网页只共享站名。
- **网页互动设置** — 顶部一个总开关，弹幕、信号、共享画线各一张卡片。
- **成员** — 按活跃、离开、离线排序。
- **自动更新** — 侧边栏关闭时扩展自行更新，也可在 ⋯ 菜单或关于页一键更新。
- **连接更稳** — 实时连接合并为一条，网络恢复或服务重启后更快重连。
- **移除** — 便利贴与引用到聊天；信号与共享画线覆盖这些用途。
- **修复** — 成员时钟偏差导致的信号与共享在看问题、文字中 emoji 被截断、代币加载时闪现“未识别”。
- **标签页组** — 第一次跟看时询问一次可选的标签页组权限，用于给组命名。不允许也能跟看。

## v0.1.3

### What's new

- **Tokens on several chains** — when one contract address exists on more than one chain, a chain tag next to the token name lets you switch, and live comments follow the chain you pick.
- **Paste a contract address in chat** — it becomes a token card, like a pasted link.
- **Search in Hot** — find a token by name or contract address. The empty live comments view lists the tokens you viewed recently.
- **Website cards** — share the token card layout, with an Open button.
- **Sentiment polls** — show headcounts from the first vote, and each commenter's stance appears next to their name.
- **Signals and shared viewing** — shared viewing is faster, signals reach background tabs showing the same page, and signals for other pages appear in chat.
- **Fixes** — missing site icons, and live comments across several windows.

### 更新内容

- **多链代币** — 同一合约地址存在于多条链时，代币名旁的链标签可切换，弹幕跟随所选链。
- **在聊天中粘贴合约地址** — 生成代币卡片，与粘贴链接一样。
- **热门搜索** — 按名称或合约地址查找代币。弹幕空状态列出最近看过的代币。
- **网站卡片** — 与代币卡片布局一致，带「打开」按钮。
- **看法投票** — 从第一票起显示人数，弹幕作者名字旁显示其看法。
- **信号与共享在看** — 共享在看更快，信号可到达显示同一网页的后台标签页，其他网页的信号在聊天中提示。
- **修复** — 网站图标缺失，以及多窗口下的弹幕问题。

## v0.1.2

### What's new

- **Token names and icons from Palside's token directory** — the server reads names and icons from the chain (with an image service as a second source) and caches them, so every surface shows the same token. Pool pages and contract pages without a chain in the URL are recognized too, across more crypto sites. The extension itself still calls no token data service or RPC, and names or icons inside shared content are ignored.
- **Faster first view** — the name shows as soon as it is read and the icon is pushed in when it lands; while either is on its way, the token face and name show a quiet loading sweep instead of a question mark.
- **Welcome page and first-run tour** — after install, with a live demo of page interactions.
- **Sign-up progress** — real phases while the account is created, ending in a confirmed state.
- **Chat** — messages sent in a burst keep their order; refined send and menu animations.
- **Live comments** — take a viewport band, from 1/4 up to full screen.

### 更新内容

- **代币名称与图标来自 Palside 代币目录** — 服务端读链（图片服务作为第二来源）并缓存，所有位置显示同一个代币。交易池页面和网址不含链的合约页面也能识别，支持更多加密网站。扩展本身仍不调用代币资料服务或 RPC，分享内容自带的名称与图标一律忽略。
- **首次查看更快** — 名称读到即显示，图标到达后推送补上；等待期间头像与名称显示扫光，而不是问号。
- **欢迎页与首次引导** — 安装后打开，带网页互动的实时演示。
- **注册进度** — 创建账号时显示真实阶段，最后显示已确认。
- **聊天** — 连发消息保持顺序；发送与菜单动画更细致。
- **弹幕** — 占网页的一段区域，从 1/4 屏到全屏可选。

## v0.1.1

### What's new

The first Chrome Web Store build.

- **Chat and live comments in one place** — the side panel has Chat and Live comments tabs, and the site switcher sits on the header.
- **Recovery phrase sign-in** — fixed a hang after the recovery phrase was verified.
- **Reworked limits** — message retention, invites and squad rules follow one shared set of parameters.
- **Hardening** — stricter extension page CSP, and page resources use dynamic URLs so sites cannot detect the extension.
- **Notifications** — use a new toast component.

### 更新内容

首个上架 Chrome 应用商店的版本。

- **聊天与弹幕同在一处** — 侧栏分为「聊天｜弹幕」两个标签，网站切换位于顶栏。
- **助记词登录** — 修复验证助记词后卡住的问题。
- **限制规则重做** — 消息保留、邀请和小队规则统一按同一组参数执行。
- **加固** — 扩展页面 CSP 更严格，网页资源使用动态地址，网站无法探测扩展。
- **通知** — 使用全新的提示组件。

## v0.1.0

### What's new

The first public release of the Palside Chrome extension and its contracts.

- **Squad watching** — see the tokens your squad has open, live in the side panel.
- **Chart signals** — mark a spot on the chart and everyone on the page sees it.
- **Live token comments** — one comment stream per token, shown on the page.
- **Encrypted squad chat** — end-to-end encrypted with Matrix Olm/Megolm; keys stay on your devices.
- **Page notes and captures** — sticky notes anchored to text, and annotated screenshots with Alt+Shift+S.
- **PALS red packets** — send PALS in chat from a wallet that signs locally.

### 更新内容

首个公开版本，包含 Palside Chrome 扩展与合约源代码。

- **小队在看** — 在侧边栏实时看到小队打开的代币。
- **图表信号** — 在图表上标记一个位置，同页的所有人都能看到。
- **代币弹幕** — 每个代币一条弹幕流，显示在网页上。
- **加密小队聊天** — 基于 Matrix Olm/Megolm 端到端加密，密钥只留在你的设备上。
- **网页便利贴与截图标注** — 锚定在文字上的便利贴，以及 Alt+Shift+S 截图标注。
- **PALS 红包** — 在聊天里用本机签名的零钱发送 PALS。
