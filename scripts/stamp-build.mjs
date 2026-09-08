// Bumps BUILD_LABEL in src/client/buildInfo.ts, run from package.json's
// predeploy hook, so a deploy can be identified — deploys can lag by minutes,
// and a stale one is otherwise indistinguishable from a fresh one. Whether the
// label is actually drawn is client/ui/buildLabel.tsx's SHOW_BUILD_LABEL,
// currently off.
//
// <short commit>-<n>: n counts builds of that commit, so uncommitted work
// still produces a distinct label each deploy. A new commit resets n to 1.
//
// .mjs rather than .js because .gitignore ignores *.js — a .js script here
// would never be committed.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUILD_INFO_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client', 'buildInfo.ts')
const LABEL_PATTERN = /(export const BUILD_LABEL = ')([^']*)(')/

function fail(message) {
  console.error(`stamp-build: ${message}`)
  process.exit(1) // non-zero aborts the deploy rather than shipping a stale label
}

const source = readFileSync(BUILD_INFO_PATH, 'utf8')
const match = source.match(LABEL_PATTERN)
if (!match) fail(`no BUILD_LABEL found in ${BUILD_INFO_PATH}`)

let commit
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  fail('could not read the current commit — is this a git repository?')
}

// Commit hashes never contain '-', so the last one separates hash from counter.
const current = match[2]
const separator = current.lastIndexOf('-')
const currentCommit = separator === -1 ? '' : current.slice(0, separator)
const currentBuild = separator === -1 ? NaN : Number(current.slice(separator + 1))
const sameCommit = currentCommit === commit && Number.isInteger(currentBuild)

const next = sameCommit ? `${commit}-${currentBuild + 1}` : `${commit}-1`

writeFileSync(BUILD_INFO_PATH, source.replace(LABEL_PATTERN, `$1${next}$3`))
console.log(`stamp-build: ${current} -> ${next}`)
