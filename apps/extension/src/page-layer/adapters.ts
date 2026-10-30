import { chartSelectors,sites } from '@palside/shared/sites';

export type SiteAdapter = {
  host: string;
  chart?: () => Element | undefined;
};

export const privateSelector = 'input,textarea,select,button,form,fieldset,option,[contenteditable],[role="textbox"],[role="button"],[role="dialog"],script,style,noscript,template,canvas,iframe,[hidden],[inert],[aria-hidden="true"],palside-page-layer,[data-trade-panel],[data-private],[autocomplete]';
const sensitive = /(?:^|[\s_-])(?:trade|trading|balances?|holdings?|positions|orders?|orderbook|portfolio|wallet|account)(?:$|[\s_-])|交易|余额|持仓|订单|账户/i;

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

/** Check the generic sensitive regions. */
export function isTradeElement(element: Element) {
  if (element.closest(privateSelector)) return true;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (['id', 'class', 'aria-label', 'data-testid'].some(name => sensitive.test((node!.getAttribute(name) ?? '').replace(/([a-z])([A-Z])/g, '$1-$2')))) return true;
  }
  return false;
}
