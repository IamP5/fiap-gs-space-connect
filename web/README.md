# SwarmBuild — web dashboard

The 2D canvas scaffold for the SwarmBuild walking skeleton (issue 01). It is a
**pure, stateless re-render of a server-authoritative world snapshot** received
over a WebSocket — there is no client-side simulation, so the dashboard can
never lie about world state (TECHSPEC §4, ADR-0004). This 2D renderer is the
throwaway safety-net scaffold that react-three-fiber 3D will later replace.

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
```

## Environment variables

Copy `.env.example` to `.env` (or `.env.local`) to override:

| Variable      | Default                  | Purpose                                              |
| ------------- | ------------------------ | ---------------------------------------------------- |
| `VITE_WS_URL` | `ws://localhost:8080/ws` | WebSocket URL of the WS gateway.                     |
| `VITE_MOCK`   | _(unset)_                | `1` → render a hardcoded mock snapshot, no socket.   |

## What it shows

- **"all systems connected" indicator** (header): green only when the WebSocket
  is OPEN **and** the latest snapshot has `connected: true`; amber when the
  socket is up but the world is not connected; red while disconnected. The
  socket auto-reconnects with capped exponential backoff, so the dashboard
  survives a gateway restart.
- **Task ledger** (top-left): every task with its `UNCLAIMED` / `LEASED` /
  `DONE` status and assignee, plus a legend.
- **2D world canvas**: tasks color-coded by status (with id, type, status
  label) and rovers with a battery ring (dimmed when `alive: false`). A rover
  holding a task draws a green dashed **lease beam** to that task. World
  coordinates are fit into the canvas with padding and re-fit on resize.

The wire contract (snapshot shape, capital `X`/`Y` on positions) lives in
`src/types/wire.ts` and mirrors `wire/wire.go` exactly.

## Project structure

Layered by technical concern (à la _bulletproof-react_); no barrel files, so
imports stay statically analyzable for tree-shaking.

```
src/
├── main.tsx              # entry point
├── App.tsx               # dashboard shell — owns selection state, composes the rest
├── components/           # presentational React components
│   ├── StatusIndicator.tsx
│   ├── TaskLedger.tsx
│   ├── KillPanel.tsx
│   └── WorldCanvas.tsx   # rAF canvas renderer of the latest snapshot
├── hooks/
│   └── useSnapshot.ts    # the single stateful hook: WS transport + latest frame
├── lib/                  # pure, DOM-free, unit-tested logic (+ co-located *.test.ts)
│   ├── connection.ts     #   header indicator derivation
│   ├── format.ts         #   battery clamp/percent helpers
│   ├── hitTest.ts        #   world→screen projection + click pick
│   └── choreography.ts   #   TTL ring + transient beat math
├── types/
│   └── wire.ts           # the wire contract (mirrors wire/wire.go)
├── mocks/
│   └── snapshot.ts       # VITE_MOCK fixture
└── styles/
    ├── index.css         # design tokens + global reset
    └── dashboard.css      # dashboard chrome
```
