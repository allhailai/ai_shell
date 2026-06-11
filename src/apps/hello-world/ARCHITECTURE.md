# Hello World — Application Architecture

> **Progressive Disclosure Document** — Start reading from the top. Stop when you have enough context.

---

## Level 0 — What Is This?

Hello World is a **reference/demo application** for the AIShell framework. It exercises every capability of the `AppManifest` contract: custom left nav with sub-routes, main content with internal routing, right panel (Shell Inspector), bottom panel (Activity Log), and a command handler (`hello.greet`).

**Purpose**: Use this app as a template and test bed when building new AIShell applications.

---

## Level 1 — File Map

```
src/apps/hello-world/
├── manifest.tsx        # AppManifest export — wires everything together
├── hello-world.css     # All styles (namespaced as .hello-*)
├── HelloContent.tsx    # Main content router (switches on URL sub-route)
├── HelloNav.tsx        # Left nav with Home and About links
├── HelloPage.tsx       # Home page — shell stats, command tester, counters
├── AboutPage.tsx       # About page — framework feature documentation
├── HelloInfoPanel.tsx  # Right panel — live shell state inspector
└── HelloLogPanel.tsx   # Bottom panel — command/event activity log
```

---

## Level 2 — Manifest

```typescript
// manifest.tsx
export const helloWorldApp: AppManifest = {
  id: "hello",                          // URL: /hello
  name: "Hello World",
  icon: WaveIcon,
  description: "Demo app exercising all AIShell chassis capabilities",
  accentColor: "hsl(200, 80%, 55%)",

  leftNav: HelloNav,                    // Sub-route navigation
  mainContent: HelloContent,            // Internal router
  rightPanel: { id: "hello-info", label: "Shell Inspector", component: HelloInfoPanel },
  bottomPanel: { id: "hello-log", label: "Activity Log", component: HelloLogPanel },

  commands: [
    { name: "hello.greet", handler: (payload) => `Hello, ${payload}! 👋` },
  ],
};
```

---

## Level 3 — Internal Routing

`HelloContent.tsx` reads the URL path after `/hello/` to determine which page to show:

| URL | Component | Description |
|-----|-----------|-------------|
| `/hello` | `HelloPage` | Dashboard with shell stats, command tester |
| `/hello/about` | `AboutPage` | Framework documentation |

Sub-route navigation is managed by `HelloNav`, which uses `window.history.pushState` directly (no React Router).

---

## Level 4 — Shell Integration Patterns Demonstrated

| Pattern | Where | How |
|---------|-------|-----|
| Custom left nav | `HelloNav.tsx` | Two nav items with active state from URL path |
| Sub-routing | `HelloContent.tsx` | Reads `window.location.pathname` via state |
| Right panel | `HelloInfoPanel.tsx` | Reads `useShellStore` to display live layout state |
| Bottom panel | `HelloLogPanel.tsx` | Subscribes to command bus events |
| Command handler | `manifest.tsx` | `hello.greet` command registered via `commands[]` |
| Panel URL params | `HelloInfoPanel.tsx` | Uses `usePanelParams("rp")` for scoped state |
| Command bus | `HelloPage.tsx` | `useCommandBus()` to invoke and listen to events |

---

## Level 5 — CSS

All styles are in `hello-world.css`, namespaced with `.hello-*` prefixes:

- `.hello-page` — Main content layout
- `.hello-nav-*` — Left navigation items
- `.hello-info-*` — Right panel inspector
- `.hello-log-*` — Bottom panel log
- `.hello-about-*` — About page

Imported globally via `src/styles.css`.
