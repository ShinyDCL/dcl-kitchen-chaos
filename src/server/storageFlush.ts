// Shared debounced-flush driver for the modules that persist to Storage
// (playerCoins.ts, leaderboard.ts, deliveryStats.ts).
//
// Writing on every change would risk two in-flight writes for the same key
// landing out of order, silently persisting the older value. Flushing the
// *current* value on an interval makes that impossible, and gives failed
// writes somewhere to retry from — Storage.set resolves false rather than
// throwing, so an unchecked loss is otherwise invisible.

/** Runs `flush` at most once per intervalSeconds, never overlapping itself. Register `system`; call `flushNow` at real checkpoints (e.g. a player leaving). */
export function createDebouncedFlush(intervalSeconds: number, flush: () => Promise<void>) {
  let elapsedSeconds = 0
  let running = false

  function flushNow(): void {
    if (running) return // in-flight one will pick up whatever's dirty; the interval retries after
    running = true
    elapsedSeconds = 0
    void flush()
      .catch(() => {
        // Swallowed so a throwing Storage call isn't an unhandled rejection;
        // whatever was dirty stays dirty and the next pass retries.
      })
      .finally(() => {
        running = false
      })
  }

  function system(dt: number): void {
    elapsedSeconds += dt
    if (elapsedSeconds >= intervalSeconds) flushNow()
  }

  return { system, flushNow }
}
