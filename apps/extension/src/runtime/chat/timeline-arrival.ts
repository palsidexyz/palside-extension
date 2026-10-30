/** Matrix timeline provenance, captured before asynchronous decryption. */
export function isLiveTimelineArrival(input: { toStart?: boolean; removed: boolean; liveEvent?: boolean; ready: boolean; timestamp: number; receiveSince: number }): boolean {
  return !input.toStart && !input.removed && input.liveEvent === true && input.ready && input.timestamp >= input.receiveSince;
}
