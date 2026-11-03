import { browserPlatform, type PlatformNavigator } from '../browser/platform.ts';

export function deviceLabel(navigatorLike: PlatformNavigator | undefined = globalThis.navigator): string {
  const platform = browserPlatform(navigatorLike);
  return platform ? `${platform} · Chrome` : 'Chrome';
}
