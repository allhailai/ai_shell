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
import type { CodaScopeWorkspaceNoteService } from "./codaScopeWorkspaceNoteService.js";
import type { WorkspaceTurnNoteGrantHolder } from "./codaScopeWorkspaceNoteGrant.js";
import type { WorkspaceMutationActionCollectorHolder } from "./codaScopeWorkspaceMutationActions.js";
import { buildWorkspaceReadTools } from "./tools/codaScopeWorkspaceReadTools.js";
import { buildWorkspaceNoteTools } from "./tools/codaScopeWorkspaceNoteTools.js";

export interface WorkspaceToolServices {
  activeResolver: CodaScopeActiveEntityResolver;
  catalog: CodaScopeWorkspaceCatalogService;
  epic: CodaScopeEpicService;
  designDoc: CodaScopeDesignDocService;
  epicKnowledge: CodaScopeEpicKnowledgeService;
  workspaceNote?: CodaScopeWorkspaceNoteService;
}

export function getWorkspaceTools(
  services: WorkspaceToolServices,
  grantHolder: WorkspaceTurnReadGrantHolder,
  provenanceHolder?: WorkspaceProvenanceCollectorHolder,
  noteGrantHolder?: WorkspaceTurnNoteGrantHolder,
  mutationActionHolder?: WorkspaceMutationActionCollectorHolder,
  actorId?: string,
): Record<string, SDKCustomTool> {
  return {
    ...buildWorkspaceReadTools(services, grantHolder, provenanceHolder),
    ...(services.workspaceNote
      && noteGrantHolder
      && mutationActionHolder
      && actorId
      ? buildWorkspaceNoteTools(
          actorId,
          services.workspaceNote,
          noteGrantHolder,
          mutationActionHolder,
        )
      : {}),
  };
}

export { buildWorkspaceReadTools } from "./tools/codaScopeWorkspaceReadTools.js";
export { buildWorkspaceNoteTools } from "./tools/codaScopeWorkspaceNoteTools.js";
