// Identifies which build is actually live, so a deploy can be confirmed at a
// glance rather than guessed at — deploys can lag by several minutes, and a
// stale one is otherwise indistinguishable from a new one.
//
// Rewritten by scripts/stamp-build.mjs from package.json's predeploy hook —
// don't edit by hand. <short commit>-<n>, where n counts builds of that
// commit, so uncommitted work still gets a distinct label per deploy.
export const BUILD_LABEL = 'dafaaa7-1'
