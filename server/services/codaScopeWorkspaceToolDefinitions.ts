/* ── CodaScope: Workspace Tool Definitions ──────────────────────────
   Dedicated read-only workspace assembly. Project tool tiers are never
   spread into this capability boundary.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool } from "@cursor/sdk";
import type { CodaScopeActiveEntityResolver } from "./codaScopeActiveEntityResolver.js";
import type { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";
import type { CodaScopeEpicKnowledgeService } from "./codaScopeEpicKnowledgeService.js";
import type { CodaScopeEpicService } from "./codaScopeEpicService.js";
import type { CodaScopeWorkspaceCatalogService } from "./codaScopeWorkspaceCatalogService.js";
import type { WorkspaceTurnReadGrantHolder } from "./codaScopeWorkspaceReadGrant.js";
import type { WorkspaceProvenanceCollectorHolder } from "./codaScopeWorkspaceProvenance.js";
import { buildWorkspaceReadTools } from "./tools/codaScopeWorkspaceReadTools.js";

export interface WorkspaceToolServices {
  activeResolver: CodaScopeActiveEntityResolver;
  catalog: CodaScopeWorkspaceCatalogService;
  epic: CodaScopeEpicService;
  designDoc: CodaScopeDesignDocService;
  epicKnowledge: CodaScopeEpicKnowledgeService;
}

export function getWorkspaceTools(
  services: WorkspaceToolServices,
  grantHolder: WorkspaceTurnReadGrantHolder,
  provenanceHolder?: WorkspaceProvenanceCollectorHolder,
): Record<string, SDKCustomTool> {
  return buildWorkspaceReadTools(services, grantHolder, provenanceHolder);
}

export { buildWorkspaceReadTools } from "./tools/codaScopeWorkspaceReadTools.js";
