// One-liner used by the modules that persist to Storage (coins.ts,
// leaderboard.ts, deliveryStats.ts).
//
// Fire-and-forget on purpose. There's no retry: all three write cumulative
// state (a whole total, the whole board), so a failed write is healed by the
// next successful one for that key. Retrying instead meant tracking
// in-flight writes and keeping the state they read from alive, which is a
// lot of coupling to buy only the case where the last write before a key
// goes idle fails.
//
// Ordering needs no help either — the SDK serializes and coalesces writes
// per key. It just never retries, hence the log so a failure isn't silent.

/** Writes without waiting. Logs rather than throwing, so a failure is visible but never an unhandled rejection. */
export function persist(label: string, write: () => Promise<boolean>): void {
  void write()
    .then((ok) => {
      if (!ok) console.error(`[server] ${label}: storage write did not persist`)
    })
    .catch((error) => {
      console.error(`[server] ${label}: storage write threw`, error)
    })
}
