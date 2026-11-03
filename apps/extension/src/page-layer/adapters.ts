import { chartSelectors,sites } from '@palside/shared/sites';

export type SiteAdapter = {
  host: string;
  chart?: () => Element | undefined;
};

export const privateSelector = 'input,textarea,select,[contenteditable],[role="textbox"],script,style,noscript,template,canvas,iframe,[hidden],[inert],[aria-hidden="true"],palside-page-layer';

const generic: SiteAdapter = { host: '*' };

const chart = (selectors: readonly string[]) => () => {
  const elements = selectors.flatMap(selector => [...document.querySelectorAll(selector)])
    .filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 160 && rect.height >= 100;
    });
  // A layout column whose class happens to mention "chart" must not win over the chart inside it.
  return elements
    .filter(element => !elements.some(other => other !== element && element.contains(other)))
    .sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
};

/** Any page: the largest chart-like block, so danmaku stays off headers and order books there too. */
export const genericChart = chart(chartSelectors);

/** Sites with registry layout hints; every other host uses the generic adapter. */
export const adapters: readonly SiteAdapter[] = sites.flatMap(site => site.layout ? [{ host: site.domain, chart: chart(site.layout.chart) }] : []);

/** Return a registered adapter or the generic address adapter. */
export function adapterFor(host = location.hostname) {
  return adapters.find(adapter => adapter.host === host) ?? { ...generic, host };
}
