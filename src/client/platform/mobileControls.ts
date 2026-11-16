// Hides the on-screen mobile action buttons this scene never uses — only
// IA_PRIMARY drives interaction (see focusManager.ts's global E-key poll).
// TouchScreenControls is a no-op on desktop, so this runs unconditionally.
//
// Lists all seven rather than only jump and pointer, which are all the SDK's
// default set (7.32.0+) still shows besides E: the explicit list keeps the
// pad to one button whatever that default becomes.

import { InputAction, TouchScreenControls } from '@dcl/sdk/ecs'

export function setupMobileControls(): void {
  TouchScreenControls.hide([
    InputAction.IA_POINTER,
    InputAction.IA_SECONDARY,
    InputAction.IA_JUMP,
    InputAction.IA_ACTION_3,
    InputAction.IA_ACTION_4,
    InputAction.IA_ACTION_5,
    InputAction.IA_ACTION_6
  ])
}
