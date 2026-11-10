import { type Viewing } from '../../../domain/assets/model';
import { pageScopeUrl, samePage, viewAsset } from '../../../domain/annotations/social';
import type { PalsideController } from '../app/use-palside';
import { tabView } from '../rooms/rooms';
import { tokenNamed } from '../../../runtime/viewing/token-profiles';
import { liveView } from '../assets/token-data';

/** The active tab owns page identity; shared views supply asset metadata only. */
export function currentPage(c: PalsideController): Viewing | undefined {
  const page = c.live?.page;
  const url = pageScopeUrl(page?.url);
  if (!url) return;
  const view = tabView(page);
  if (!view) return;
  // Identity is the tab's; name and icon come from the token's one record, else a named view of the same asset.
  const views = page?.asset ? c.data.views.filter(item => viewAsset(item) === page.asset) : [];
  const known = views.find(item => tokenNamed(item) && samePage(item.url, url)) ?? views.find(item => tokenNamed(item));
  return liveView(c, { ...view, url, ...(known ? { name: known.name, logo: known.logo, color: known.color, glyph: known.glyph } : {}) });
}
