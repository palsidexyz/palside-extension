import { API_URL } from '../src/runtime/composition/config';

/** Review pages report their outcome on `<html data-review>` so `scripts/check-review-pages.mjs` can run them unattended. */
export type ReviewStatus = 'passed' | 'failed' | 'ready';
export function reviewStatus(status: ReviewStatus) { document.documentElement.dataset.review = status; }
/** `?run` starts a self-check page's whole sequence on load instead of waiting for its buttons. */
export const autoRun = new URLSearchParams(location.search).has('run');

// Review pages run against fixtures only: a request to the configured service is a fixture bug, never a live call.
const fetchService = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.origin !== new URL(API_URL).origin) return fetchService(input, init);
  console.error(`Review page reached the service: ${url.pathname}`);
  return Promise.reject(new TypeError('Review pages never reach the service'));
};
