/* ── CodaScope: Server Routes (Hub) ───────────────────────────────────
   Thin hub that assembles all CodaScope API routes under /api/codascope/.
   All domain routes are split into sub-modules.
   ──────────────────────────────────────────────────────────────────── */

import type { Express } from "express";

// ── Service Context + Sub-Routes ─────────────────────────────────────
import {
  createRouteContext,
  type CodaScopeRoutesDeps,
} from "./codaScopeServiceContext.js";
import { registerCoreRoutes } from "./codaScopeCoreRoutes.js";
import { registerWikiRoutes } from "./codaScopeWikiRoutes.js";
import { registerBuildRoutes } from "./codaScopeBuildRoutes.js";
import { registerChatRoutes } from "./codaScopeChatRoutes.js";
import { registerEpicRoutes } from "./codaScopeEpicRoutes.js";
import { registerAnnotationRoutes } from "./codaScopeAnnotationRoutes.js";
import { registerKnowledgeRoutes } from "./codaScopeKnowledgeRoutes.js";
import { registerArtifactRoutes } from "./codaScopeArtifactRoutes.js";
import { registerNoteRoutes } from "./codaScopeNoteRoutes.js";

export { type CodaScopeRoutesDeps } from "./codaScopeServiceContext.js";

export function registerCodaScopeRoutes(app: Express, deps: CodaScopeRoutesDeps): void {
  const ctx = createRouteContext(app, deps);

  registerCoreRoutes(ctx);
  registerWikiRoutes(ctx);
  registerBuildRoutes(ctx);
  registerChatRoutes(ctx);
  registerEpicRoutes(ctx);
  registerAnnotationRoutes(ctx);
  registerKnowledgeRoutes(ctx);
  registerArtifactRoutes(ctx);
  registerNoteRoutes(ctx);
}
