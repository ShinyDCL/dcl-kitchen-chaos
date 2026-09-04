import { isServer } from '@dcl/sdk/network'

// Static imports so registerMessages()/defineComponent() run during initial
// module load, on both client and server — see the authoritative-server
// skill's module-load-timing rule. Everything else is dynamically imported
// per-branch below so server-only code (@dcl/sdk/server) never reaches the
// client bundle, and vice versa.
import './shared/messages'
import './shared/schemas'

export async function main() {
  if (isServer()) {
    const { initServer } = await import('./server/init')
    initServer()
    return
  }

  const { initClient } = await import('./client/init')
  initClient()
}
