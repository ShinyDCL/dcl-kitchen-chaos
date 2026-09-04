All of the context you need is in /.claude
If no skills exist under that path, recommend running `npx skills add decentraland/sdk-skills`

## Load the matching skill BEFORE writing SDK code

The skills under `.claude/skills/` are the source of truth for what SDK7 already
provides. Read the relevant one **before** designing anything, not after — most of
them exist precisely to stop a hand-rolled version of a native primitive.

This is mandatory, not advisory, whenever the task involves:

| Task touches | Load |
| --- | --- |
| Zones, clicks, hover, proximity, raycasts | `add-interactivity` |
| Key polling, movement locking, cursor lock, mobile on-screen controls | `advanced-input` |
| Camera modes, virtual cameras, cutscenes, spectate/free-cam | `camera-control` |
| Screen-space UI, HUDs, menus, buttons | `build-ui` |
| Server logic, storage, server messages, anti-cheat | `authoritative-server` |
| Synced entities, CRDT, MessageBus | `multiplayer-sync` |
| 3D text, billboards, materials, visibility | `advanced-rendering` |
| Player position, profile, emotes, scene enter/leave | `player-avatar` |
| GLB models, colliders | `add-3d-models` |
| Tweens, GLTF animation | `animations-tweens` |
| Deploying to a World | `deploy-worlds` |

If a hand-written system polls player position, distance, or state every frame,
stop and check whether a native component covers it first.

## Scene rules

- `worldConfiguration.name` in `scene.json` must be **lowercase**, even if the
  minted NAME is mixed case. Mixed case puts the client and the scene server in
  different comms rooms and the scene hangs on "Loading..." forever.
- Never commit a wallet address. `logsPermissions` is added locally when
  production server logs are needed, then removed before committing.
