# AIShell Settings — Agent Guidelines

## Scope

`src/apps/settings` is the user-facing, deep-linkable AIShell Settings app.
It owns personal settings UI only. System administration remains in
`src/apps/admin`, and persistence/authentication remains in the shell server.

## Conventions

- Use `useAppSubRoute("settings")` for all routes. `/settings/keybindings` is
  the stable link target for Markdown editor shortcuts.
- Keep CSS classes prefixed with `settings-` and use shell design tokens.
- Do not call CodaScope routes or store user settings in CodaScope data.
- Use `useUserSettings()` for the authenticated, server-backed profile; do not
  make localStorage the source of truth.
- Validate and preview imports before saving. Replace imports require explicit
  confirmation and must never silently discard conflicting bindings.

## Verification

- Keep direct navigation, refresh, and back/forward working for every route.
- Add focused tests for pure keybinding/persistence behavior when changing the
  profile format or command registry.
- Run the repository type checks, tests, production build, and `git diff --check`.
