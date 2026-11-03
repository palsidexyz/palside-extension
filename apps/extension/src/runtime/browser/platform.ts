export type PlatformNavigator = { userAgentData?: { platform?: string }; userAgent?: string };

export function browserPlatform(navigatorLike: PlatformNavigator | undefined = globalThis.navigator): string {
  const value = navigatorLike?.userAgentData?.platform || navigatorLike?.userAgent || '';
  return /mac/i.test(value) ? 'macOS' : /win/i.test(value) ? 'Windows' : /cros|chrome ?os/i.test(value) ? 'ChromeOS' : /linux/i.test(value) ? 'Linux' : '';
}
