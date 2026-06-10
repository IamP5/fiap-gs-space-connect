# SwarmBuild — web dashboard

The 3D dashboard for SwarmBuild. It is a **pure, stateless re-render of a
server-authoritative world snapshot** received over a WebSocket — there is no
client-side simulation, so the dashboard can never lie about world state
(TECHSPEC §4, ADR-0004). The renderer is react-three-fiber; primitive in-scene
fallbacks cover any per-asset load failure.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

By default the dashboard connects to the WS gateway at
`ws://localhost:8080/ws`. The gateway fans out the full world snapshot at
~10 Hz; the dashboard keeps only the latest one and renders it.

### See it without a backend (mock)

```bash
VITE_MOCK=1 npm run dev
```

Feeds a single hardcoded snapshot (all three task statuses, an alive + a dead
rover, a lease beam) so the UI is visible with no gateway running.

### Build

```bash
npm run build    # tsc -b && vite build — must be TypeScript-clean
npm test         # vitest
```

## Environment variables

Copy `.env.example` to `.env` (or `.env.local`) to override:

| Variable      | Default                  | Purpose                                            |
| ------------- | ------------------------ | -------------------------------------------------- |
| `VITE_WS_URL` | `ws://localhost:8080/ws` | WebSocket URL of the WS gateway.                   |
| `VITE_MOCK`   | _(unset)_                | `1` → render a hardcoded mock snapshot, no socket. |

## What it shows

- **"all systems connected" indicator** (top bar): green only when the WebSocket
  is OPEN **and** the latest snapshot has `connected: true`; amber when the
  socket is up but the world is not connected; red while disconnected. The
  socket auto-reconnects with capped exponential backoff, so the dashboard
  survives a gateway restart.
- **3D scene**: an orbit view (Moon vista + clickable site markers) and a
  surface view (the worksite: terrain, structures rising op-by-op, rovers with
  lease beams and TTL rings). Click a marker to descend.
- **Mission HUD** (top-left): site-scoped build progress + rovers-alive count;
  click to expand the per-task list.
- **Hotbar** (bottom): blueprint placement glyphs (dome / solar-array /
  comms-mast), stress popovers (latency / failure probability), and the site
  chip (Lunar ↔ Shackleton).
- **Kill panel**: click a rover, then KILL — the rover goes dark in place, its
  lease expires, the swarm self-heals, and it revives after its outage window.
- **Earth panel** (bottom-right): the delayed Earth view that lags the live HUD
  as latency climbs.

The wire contract (snapshot shape, capital `X`/`Y` on positions) lives in
`src/types/wire.ts` and mirrors `internal/wire/wire.go` exactly.

## Project structure

Layered by technical concern; no barrel files, so imports stay statically
analyzable for tree-shaking.

```
src/
├── main.tsx              # entry point
├── App.tsx               # dashboard shell — owns selection/placement state
├── components/           # presentational React components + the 3D scene
├── hooks/
│   └── useSnapshot.ts    # the single stateful hook: WS transport + latest frame
├── lib/                  # pure, DOM-free, unit-tested logic (+ co-located *.test.ts)
├── types/
│   └── wire.ts           # the wire contract (mirrors internal/wire/wire.go)
├── mocks/
│   └── snapshot.ts       # VITE_MOCK fixture
└── styles/
    ├── index.css         # design tokens + global reset
    └── dashboard.css     # dashboard chrome
```
