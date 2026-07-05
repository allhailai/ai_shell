/* ── CodaScope: Tool Service Factory ─────────────────────────────────
   Single factory that creates all service instances needed by tool
   builders. Called once per `getToolsForPurpose()` invocation instead
   of 4× independently in each builder function.
   ──────────────────────────────────────────────────────────────────── */

import { CodaScopeWikiService } from "./codaScopeWikiService.js";
import { CodaScopeProjectService } from "./codaScopeProjectService.js";
import { CodaScopeCodeMapService } from "./codaScopeCodeMapService.js";
import { CodaScopeQualityService } from "./codaScopeQualityService.js";
import { CodaScopeGoldenRuleService } from "./codaScopeGoldenRuleService.js";
import { CodaScopeConceptService } from "./codaScopeConceptService.js";
import { CodaScopeBuildStateService } from "./codaScopeBuildStateService.js";
import { CodaScopeEpicService } from "./codaScopeEpicService.js";
import { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";
import { CodaScopeAnnotationService } from "./codaScopeAnnotationService.js";
import { CodaScopeEpicKnowledgeService } from "./codaScopeEpicKnowledgeService.js";
import { CodaScopeCurationService } from "./codaScopeCurationService.js";
import { CodaScopeArtifactService } from "./codaScopeArtifactService.js";

/** All service instances used across tool tiers. */
export interface ToolServices {
  wiki: CodaScopeWikiService;
  project: CodaScopeProjectService;
  codeMap: CodaScopeCodeMapService;
  quality: CodaScopeQualityService;
  goldenRule: CodaScopeGoldenRuleService;
  concept: CodaScopeConceptService;
  buildState: CodaScopeBuildStateService;
  epic: CodaScopeEpicService;
  designDoc: CodaScopeDesignDocService;
  annotation: CodaScopeAnnotationService;
  epicKnowledge: CodaScopeEpicKnowledgeService;
  curation: CodaScopeCurationService;
  artifact: CodaScopeArtifactService;
}

/**
 * Create all service instances for tool building.
 * Called once per `getToolsForPurpose()` invocation — services are
 * shared across whichever tool tiers are composed for the purpose.
 */
export function createToolServices(projectsRoot: string): ToolServices {
  return {
    wiki: new CodaScopeWikiService(projectsRoot),
    project: new CodaScopeProjectService(projectsRoot),
    codeMap: new CodaScopeCodeMapService(projectsRoot),
    quality: new CodaScopeQualityService(projectsRoot),
    goldenRule: new CodaScopeGoldenRuleService(projectsRoot),
    concept: new CodaScopeConceptService(projectsRoot),
    buildState: new CodaScopeBuildStateService(projectsRoot),
    epic: new CodaScopeEpicService(projectsRoot),
    designDoc: new CodaScopeDesignDocService(projectsRoot),
    annotation: new CodaScopeAnnotationService(projectsRoot),
    epicKnowledge: new CodaScopeEpicKnowledgeService(projectsRoot),
    curation: new CodaScopeCurationService(projectsRoot),
    artifact: new CodaScopeArtifactService(projectsRoot),
  };
}
