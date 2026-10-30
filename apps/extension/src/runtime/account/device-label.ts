export function deviceLabel(navigatorLike: { userAgentData?: { platform?: string }; platform?: string } = globalThis.navigator): string {
  const value = navigatorLike.userAgentData?.platform || navigatorLike.platform || '';
  const platform = /mac/i.test(value) ? 'macOS' : /win/i.test(value) ? 'Windows' : /cros|chrome ?os/i.test(value) ? 'ChromeOS' : /linux/i.test(value) ? 'Linux' : '';
  return platform ? `${platform} · Chrome` : 'Chrome';
}
