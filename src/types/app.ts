import type { ComponentType } from "react";

/* ── Application Contract Types ──────────────────────────────────────
   This is the API surface that application authors code against.
   The shell imports these types to build layout regions and commands.

   Naming convention: app IDs are lowercase kebab-case (e.g., "hello-world").
   ──────────────────────────────────────────────────────────────────── */

/** Unique application identifier — used in URLs, registry, commands. */
export type AppId = string;

/**
 * A panel widget an application provides for the right or bottom region.
 *
 * The panel ID appears in the URL as `?rp=<id>` or `?bp=<id>`.
 * Panel-specific state can be passed via `?rp.<key>=<value>` or `?bp.<key>=<value>`.
 */
export interface PanelRegistration {
  /** Unique panel ID — used in URL query params. */
  id: string;
  /** Display label for the panel header. */
  label: string;
  /** Optional icon component for tabs/headers. */
  icon?: ComponentType<{ size?: number }>;
  /** The panel content component. Receives `params` from the URL. */
  component: ComponentType<{ params?: Record<string, string> }>;
  /** Default size in pixels (width for right panel, height for bottom). */
  defaultSize?: number;
  /** Minimum size constraint in pixels. */
  minSize?: number;
  /** Maximum size constraint in pixels. */
  maxSize?: number;
}

/**
 * A command handler an application registers on the command bus.
 *
 * Commands are namespaced as `appId.commandName` by convention.
 * Handlers receive an unknown payload and may return a value (sync or async).
 */
export interface CommandRegistration {
  /** Command name (e.g., "hello.greet"). */
  name: string;
  /** Handler function. */
  handler: (payload: unknown) => unknown | Promise<unknown>;
}

/**
 * The full application manifest — everything the shell needs to host an app.
 *
 * Applications export a single `AppManifest` from their `manifest.ts` file.
 * The shell registry imports these at compile time.
 *
 * Unlike the old plugin model (where the shell owned the layout and plugins
 * injected content), each application has **full control** over every UI
 * region when it's active.
 */
export interface AppManifest {
  /** Unique identifier — used in URLs as `/:appId`. */
  id: AppId;
  /** Human-readable name shown on the landing page and header. */
  name: string;
  /** Icon component for app cards and the header breadcrumb. */
  icon?: ComponentType<{ size?: number }>;
  /** Short description for the landing page card. */
  description?: string;
  /** Accent color for the landing page card (CSS value, e.g. "hsl(200, 80%, 55%)"). */
  accentColor?: string;

  /**
   * If true, this is a system app (e.g., Admin/Settings).
   * System apps are:
   * - Hidden from the landing page card grid
   * - Rendered at the bottom of the left nav with a separator
   */
  system?: boolean;

  /** Restrict this application to authenticated AIShell administrators. */
  requiresAdmin?: boolean;

  // ── UI Region Components ──────────────────────────────────────────

  /**
   * Left navigation component rendered when this app is active.
   * If omitted, the left nav is hidden (or collapsed to just a home button).
   */
  leftNav?: ComponentType;

  /**
   * Main canvas content component. This is always required.
   * The app owns internal sub-routing if needed.
   */
  mainContent: ComponentType;

  /**
   * Right panel registration. If provided, the shell's right panel
   * toggle becomes available and renders this panel.
   */
  rightPanel?: PanelRegistration;

  /**
   * Bottom panel registration. If provided, the shell's bottom panel
   * toggle becomes available and renders this panel.
   */
  bottomPanel?: PanelRegistration;

  /**
   * Header items component injected into the topbar, rendered to the
   * left of the panel toggle buttons. Use for app-specific actions,
   * breadcrumbs, or status indicators.
   */
  headerItems?: ComponentType;

  // ── Lifecycle ─────────────────────────────────────────────────────

  /** Commands this app registers on the command bus. */
  commands?: CommandRegistration[];

  // ── Secrets ───────────────────────────────────────────────────────

  /**
   * Secrets this app needs. The shell manages secure storage;
   * the app declares what it needs and uses the useSecrets hooks to read.
   *
   * Example:
   * ```ts
   * secrets: [
   *   { key: "api_key", label: "API Key", scope: "app", required: true },
   *   { key: "openai_org", label: "OpenAI Org", scope: "global" },
   * ]
   * ```
   */
  secrets?: SecretDeclaration[];
}

/**
 * A secret that an application declares it needs.
 *
 * The shell provides centralized UI to acquire and manage these secrets.
 * Applications read values at runtime via useAppSecret(), useGlobalSecret(),
 * or useUserSecret() hooks.
 */
export interface SecretDeclaration {
  /** Secret key identifier (e.g., "api_key"). */
  key: string;
  /** Human-readable label shown in the settings UI. */
  label: string;
  /** Help text / description shown in the settings UI. */
  description?: string;
  /**
   * Which scope this secret lives in:
   * - "global": Shared by all apps, all users (admin-writable).
   * - "app": Scoped to this application only.
   * - "user": Per-user secret (each user has their own value).
   */
  scope: "global" | "app" | "user";
  /** If true, the shell shows a warning when this secret is missing. */
  required?: boolean;
  /** If true (default), the value is masked in the UI. */
  sensitive?: boolean;
}
