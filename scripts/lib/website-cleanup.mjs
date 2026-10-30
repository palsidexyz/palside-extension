/** Stop request producers before releasing the business service and its database. */
export function websiteCleanup(resources) {
  let closing;
  return () => closing ??= (async () => {
    const { chrome, website, business } = resources();
    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => chrome?.close()),
      Promise.resolve().then(() => website?.close()),
    ]);
    outcomes.push(...await Promise.allSettled([Promise.resolve().then(() => business?.close())]));
    const errors = outcomes.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Website cleanup failed');
  })();
}
