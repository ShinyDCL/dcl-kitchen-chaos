// Shared across the coin HUD, the leaderboard and the info panel, so every
// figure the player reads is formatted the same way.

/** Thousands-separated, e.g. 12500 -> "12,500". Done by hand rather than toLocaleString, which isn't dependable in the scene runtime. */
export function formatNumber(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
