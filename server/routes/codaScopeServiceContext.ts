/* ── CodaScope: Shared Service Context ────────────────────────────────
   Singleton service instances, initialization, and shared helpers used
   by all CodaScope sub-route files.
   ──────────────────────────────────────────────────────────────────── */

import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import path from "node:path";
import type { SecretService } from "../services/secretService.js";
import type { User } from "../services/authService.js";
import { CodaScopeProjectService } from "../services/codaScopeProjectService.js";
import { CodaScopeWikiService } from "../services/codaScopeWikiService.js";
import { CodaScopeChatService } from "../services/codaScopeChatService.js";
import { CodaScopeSkillService } from "../services/codaScopeSkillService.js";
import { CodaScopeAgentService } from "../services/codaScopeAgentService.js";
import { CodaScopeBuildStateService } from "../services/codaScopeBuildStateService.js";
import { CodaScopeCodeMapService } from "../services/codaScopeCodeMapService.js";

import { CodaScopeWikiStateService } from "../services/codaScopeWikiStateService.js";
import { CodaScopeEpicService } from "../services/codaScopeEpicService.js";
import { CodaScopeDesignDocService } from "../services/codaScopeDesignDocService.js";
import { CodaScopeVersionService } from "../services/codaScopeVersionService.js";
import { CodaScopeAnnotationService } from "../services/codaScopeAnnotationService.js";
import { CodaScopeEpicRenderService } from "../services/codaScopeEpicRenderService.js";
import { CodaScopeEpicKnowledgeService } from "../services/codaScopeEpicKnowledgeService.js";
import { CodaScopeCurationService } from "../services/codaScopeCurationService.js";
import { CodaScopeContentService } from "../services/codaScopeContentService.js";
import { CodaScopeImageService } from "../services/codaScopeImageService.js";
import { CodaScopeArtifactService } from "../services/codaScopeArtifactService.js";
import { CodaScopeArtifactAnnotationService } from "../services/codaScopeArtifactAnnotationService.js";
import { CodaScopeArtifactVersionService } from "../services/codaScopeArtifactVersionService.js";
import { CodaScopeLockService } from "../services/codaScopeLockService.js";
import { CodaScopeDirectiveService } from "../services/codaScopeDirectiveService.js";
import { ProjectDirResolver } from "../services/codaScopeProjectDirResolver.js";
import { CodaScopeNoteService } from "../services/codaScopeNoteService.js";
import { CodaScopeNoteAnnotationService } from "../services/codaScopeNoteAnnotationService.js";
import { CodaScopeNoteBundleService } from "../services/codaScopeNoteBundleService.js";
import { CodaScopeNoteAuditService } from "../services/codaScopeNoteAuditService.js";
import { CodaScopeNoteUserPrefsService } from "../services/codaScopeNoteUserPrefsService.js";
import { CodaScopeNoteLinkIndexService } from "../services/codaScopeNoteLinkIndexService.js";
import { CodaScopeNoteExportService } from "../services/codaScopeNoteExportService.js";
import { CodaScopeNoteImportService } from "../services/codaScopeNoteImportService.js";
import { CodaScopeNoteTagSuggestionService } from "../services/codaScopeNoteTagSuggestionService.js";
import { CodaScopeNoteTransferService } from "../services/codaScopeNoteTransferService.js";
import multer from "multer";

// ── Types ────────────────────────────────────────────────────────────

export type HttpErrorFn = (message: string, status: number, code: string) => Error;

/** The authenticated identity available to every CodaScope route. */
export interface CodaScopePrincipal {
  username: string;
  isAdmin: boolean;
}

export interface CodaScopeRoutesDeps {
  secretService: SecretService;
  authMiddleware: Record<string, unknown>;
  httpError: HttpErrorFn;
  /** AIShell's checkout. Mutable CodaScope project data must not be stored below it. */
  repoRoot: string;
}

export interface CodaScopeServices {
  projectSvc: CodaScopeProjectService;
  wikiSvc: CodaScopeWikiService;
  chatSvc: CodaScopeChatService;
  skillSvc: CodaScopeSkillService;
  agentSvc: CodaScopeAgentService;
  buildSvc: CodaScopeBuildStateService;
  codeMapSvc: CodaScopeCodeMapService;

  wikiStateSvc: CodaScopeWikiStateService;
  epicSvc: CodaScopeEpicService;
  designDocSvc: CodaScopeDesignDocService;
  versionSvc: CodaScopeVersionService;
  annotationSvc: CodaScopeAnnotationService;
  renderSvc: CodaScopeEpicRenderService;
  epicKnowledgeSvc: CodaScopeEpicKnowledgeService;
  curationSvc: CodaScopeCurationService;
  contentSvc: CodaScopeContentService;
  imageSvc: CodaScopeImageService;
  artifactSvc: CodaScopeArtifactService;
  artifactAnnotationSvc: CodaScopeArtifactAnnotationService;
  artifactVersionSvc: CodaScopeArtifactVersionService;
  lockSvc: CodaScopeLockService;
  directiveSvc: CodaScopeDirectiveService;
  noteSvc: CodaScopeNoteService;
  noteAnnotationSvc: CodaScopeNoteAnnotationService;
  noteBundleSvc: CodaScopeNoteBundleService;
  noteAuditSvc: CodaScopeNoteAuditService;
  noteUserPrefsSvc: CodaScopeNoteUserPrefsService;
  noteLinkIndexSvc: CodaScopeNoteLinkIndexService;
  noteExportSvc: CodaScopeNoteExportService;
  noteImportSvc: CodaScopeNoteImportService;
  noteTagSuggestionSvc: CodaScopeNoteTagSuggestionService;
  noteTransferSvc: CodaScopeNoteTransferService;
}

/** Everything a sub-route file needs to register its endpoints. */
export interface CodaScopeRouteContext {
  app: Express;
  secretService: SecretService;
  httpError: HttpErrorFn;
  repoRoot: string;
  ensureServices: () => Promise<CodaScopeServices>;
  wrap: (fn: (req: Request, res: Response) => Promise<void>) => RequestHandler;
  param: (req: Request, name: string) => string;
  principal: (req: Request) => CodaScopePrincipal;
  upload: multer.Multer;
}

// ── Constants ────────────────────────────────────────────────────────

export const CONFIG_KEY = "codascope_projects_root";
export const APP_ID = "codascope";

// ── Singleton Service Instances ──────────────────────────────────────

let projectService: CodaScopeProjectService | null = null;
let dirResolver: ProjectDirResolver | null = null;
let wikiService: CodaScopeWikiService | null = null;
let chatService: CodaScopeChatService | null = null;
let skillService: CodaScopeSkillService | null = null;
let agentService: CodaScopeAgentService | null = null;
let buildStateService: CodaScopeBuildStateService | null = null;
let codeMapService: CodaScopeCodeMapService | null = null;

let wikiStateService: CodaScopeWikiStateService | null = null;
let epicService: CodaScopeEpicService | null = null;
let designDocService: CodaScopeDesignDocService | null = null;
let versionService: CodaScopeVersionService | null = null;
let annotationService: CodaScopeAnnotationService | null = null;
let renderService: CodaScopeEpicRenderService | null = null;
let epicKnowledgeService: CodaScopeEpicKnowledgeService | null = null;
let curationService: CodaScopeCurationService | null = null;
let contentService: CodaScopeContentService | null = null;
let imageService: CodaScopeImageService | null = null;
let artifactService: CodaScopeArtifactService | null = null;
let artifactAnnotationService: CodaScopeArtifactAnnotationService | null = null;
let artifactVersionService: CodaScopeArtifactVersionService | null = null;
let lockService: CodaScopeLockService | null = null;
let directiveService: CodaScopeDirectiveService | null = null;
let noteService: CodaScopeNoteService | null = null;
let noteAnnotationService: CodaScopeNoteAnnotationService | null = null;
let noteBundleService: CodaScopeNoteBundleService | null = null;
let noteAuditService: CodaScopeNoteAuditService | null = null;
let noteUserPrefsService: CodaScopeNoteUserPrefsService | null = null;
let noteLinkIndexService: CodaScopeNoteLinkIndexService | null = null;
let noteExportService: CodaScopeNoteExportService | null = null;
let noteImportService: CodaScopeNoteImportService | null = null;
let noteTagSuggestionService: CodaScopeNoteTagSuggestionService | null = null;
let noteTransferService: CodaScopeNoteTransferService | null = null;

// ── Multer ──────────────────────────────────────────────────────────

/** Multer instance for file upload handling. */
export const uploadInstance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

// ── Config Helpers ──────────────────────────────────────────────────

export async function getProjectsRoot(secretService: SecretService): Promise<string | null> {
  return secretService.getAppSecret(APP_ID, CONFIG_KEY);
}

export async function setProjectsRoot(secretService: SecretService, value: string): Promise<void> {
  return secretService.setAppSecret(APP_ID, CONFIG_KEY, value);
}

/** True when candidate is the AIShell checkout itself or a descendant of it. */
export function isInsideInstallDirectory(candidate: string, repoRoot: string): boolean {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** Prevent mutable CodaScope project data from being written into AIShell source. */
export function assertProjectsRootOutsideInstall(root: string, repoRoot: string, httpError: HttpErrorFn): void {
  if (isInsideInstallDirectory(root, repoRoot)) {
    throw httpError(
      "CodaScope projects root must be outside the AIShell installation directory.",
      400,
      "projects_root_inside_install",
    );
  }
}

// ── Param Helper ────────────────────────────────────────────────────

/** Safely extract a string route param. */
export function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] ?? "" : val ?? "";
}

/**
 * Convert the shell authentication middleware's request user into the only
 * identity CodaScope routes may use. Never fall back to request headers or
 * request payloads for an actor identity.
 */
export function principal(req: Request, httpError: HttpErrorFn): CodaScopePrincipal {
  const user = req.user as User | undefined;
  if (!user?.username) {
    throw httpError("Authentication required.", 401, "authentication_required");
  }
  return { username: user.username, isAdmin: user.is_admin === true };
}

// ── Service Initialization ──────────────────────────────────────────

async function ensureServicesImpl(secretService: SecretService, httpError: HttpErrorFn, repoRoot: string): Promise<CodaScopeServices> {
  const configuredRoot = await getProjectsRoot(secretService);
  if (!configuredRoot) throw httpError("CodaScope is not configured. Set the projects root first.", 400, "not_configured");
  assertProjectsRootOutsideInstall(configuredRoot, repoRoot, httpError);
  const root = path.resolve(configuredRoot);

  if (!projectService) projectService = new CodaScopeProjectService(root);
  else projectService.setRoot(root);

  // Initialize or update the cached project directory resolver
  if (!dirResolver) dirResolver = new ProjectDirResolver(root);
  else dirResolver.setRoot(root);
  projectService.setDirResolver(dirResolver);

  if (!wikiService) wikiService = new CodaScopeWikiService(root);
  else wikiService.setRoot(root);

  if (!chatService) chatService = new CodaScopeChatService(root);
  else chatService.setRoot(root);

  if (!skillService) skillService = new CodaScopeSkillService(root);
  else skillService.setRoot(root);

  if (!agentService) agentService = new CodaScopeAgentService(secretService, root);
  else agentService.setProjectsRoot(root);

  if (!buildStateService) buildStateService = new CodaScopeBuildStateService(root);
  else buildStateService.setRoot(root);

  if (!codeMapService) codeMapService = new CodaScopeCodeMapService(root);
  else codeMapService.setRoot(root);



  if (!wikiStateService) wikiStateService = new CodaScopeWikiStateService(root);
  else wikiStateService.setRoot(root);

  if (!epicService) epicService = new CodaScopeEpicService(root);
  else epicService.setRoot(root);

  if (!designDocService) designDocService = new CodaScopeDesignDocService(root);
  else designDocService.setRoot(root);

  if (!versionService) versionService = new CodaScopeVersionService(root);
  else versionService.setRoot(root);

  if (!annotationService) annotationService = new CodaScopeAnnotationService(root);
  else annotationService.setRoot(root);

  if (!renderService) renderService = new CodaScopeEpicRenderService(root);
  else renderService.setRoot(root);

  if (!epicKnowledgeService) epicKnowledgeService = new CodaScopeEpicKnowledgeService(root);
  else epicKnowledgeService.setRoot(root);

  if (!curationService) curationService = new CodaScopeCurationService(root);
  else curationService.setRoot(root);

  if (!contentService) contentService = new CodaScopeContentService();

  if (!imageService) imageService = new CodaScopeImageService(root);
  else imageService.setRoot(root);

  if (!artifactService) artifactService = new CodaScopeArtifactService(root);
  else artifactService.setRoot(root);

  if (!artifactAnnotationService) artifactAnnotationService = new CodaScopeArtifactAnnotationService(root);
  else artifactAnnotationService.setRoot(root);

  if (!artifactVersionService) artifactVersionService = new CodaScopeArtifactVersionService(root);
  else artifactVersionService.setRoot(root);

  if (!lockService) lockService = new CodaScopeLockService(root);
  else lockService.setRoot(root);

  if (!directiveService) directiveService = new CodaScopeDirectiveService(root);
  else directiveService.setRoot(root);

  if (!noteService) noteService = new CodaScopeNoteService(root, dirResolver);
  else { noteService.setRoot(root); noteService.setDirResolver(dirResolver); }

  if (!noteAnnotationService) noteAnnotationService = new CodaScopeNoteAnnotationService(noteService);
  else noteAnnotationService.setNoteService(noteService);

  if (!noteBundleService) noteBundleService = new CodaScopeNoteBundleService(noteService, noteAnnotationService);
  else noteBundleService.setServices(noteService, noteAnnotationService);

  if (!noteAuditService) noteAuditService = new CodaScopeNoteAuditService(root);
  else noteAuditService.setRoot(root);

  if (!noteUserPrefsService) noteUserPrefsService = new CodaScopeNoteUserPrefsService(root);
  else noteUserPrefsService.setRoot(root);

  if (!noteLinkIndexService) noteLinkIndexService = new CodaScopeNoteLinkIndexService(noteService);
  else noteLinkIndexService.setNoteService(noteService);

  if (!noteExportService) noteExportService = new CodaScopeNoteExportService(root, noteService, noteAuditService, noteBundleService);
  else { noteExportService.setRoot(root); noteExportService.setServices(noteService, noteAuditService, noteBundleService); }

  if (!noteImportService) noteImportService = new CodaScopeNoteImportService(root, noteService, noteAuditService, noteBundleService);
  else { noteImportService.setRoot(root); noteImportService.setServices(noteService, noteAuditService, noteBundleService); }

  if (!noteTagSuggestionService) noteTagSuggestionService = new CodaScopeNoteTagSuggestionService(root);
  else noteTagSuggestionService.setRoot(root);

  if (!noteTransferService) {
    noteTransferService = new CodaScopeNoteTransferService(
      noteService,
      noteBundleService,
      noteUserPrefsService,
      noteLinkIndexService,
      noteAuditService,
    );
  } else {
    noteTransferService.setServices(
      noteService,
      noteBundleService,
      noteUserPrefsService,
      noteLinkIndexService,
      noteAuditService,
    );
  }

  return {
    projectSvc: projectService,
    wikiSvc: wikiService,
    chatSvc: chatService,
    skillSvc: skillService,
    agentSvc: agentService,
    buildSvc: buildStateService,
    codeMapSvc: codeMapService,

    wikiStateSvc: wikiStateService,
    epicSvc: epicService,
    designDocSvc: designDocService,
    versionSvc: versionService,
    annotationSvc: annotationService,
    renderSvc: renderService,
    epicKnowledgeSvc: epicKnowledgeService,
    curationSvc: curationService,
    contentSvc: contentService,
    imageSvc: imageService,
    artifactSvc: artifactService,
    artifactAnnotationSvc: artifactAnnotationService,
    artifactVersionSvc: artifactVersionService,
    lockSvc: lockService,
    directiveSvc: directiveService,
    noteSvc: noteService,
    noteAnnotationSvc: noteAnnotationService,
    noteBundleSvc: noteBundleService,
    noteAuditSvc: noteAuditService,
    noteUserPrefsSvc: noteUserPrefsService,
    noteLinkIndexSvc: noteLinkIndexService,
    noteExportSvc: noteExportService,
    noteImportSvc: noteImportService,
    noteTagSuggestionSvc: noteTagSuggestionService,
    noteTransferSvc: noteTransferService,
  };
}

// ── Exported: agentService accessor (used by validate-api-key route) ─

export function getAgentServiceSingleton(): CodaScopeAgentService | null {
  return agentService;
}

// ── Route Context Factory ───────────────────────────────────────────

/** Build a CodaScopeRouteContext from the raw deps — called once in the hub. */
export function createRouteContext(app: Express, deps: CodaScopeRoutesDeps): CodaScopeRouteContext {
  const { secretService, httpError, repoRoot } = deps;

  const wrap = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler => {
    return (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };
  };

  return {
    app,
    secretService,
    httpError,
    repoRoot,
    ensureServices: () => ensureServicesImpl(secretService, httpError, repoRoot),
    wrap,
    param,
    principal: (req) => principal(req, httpError),
    upload: uploadInstance,
  };
}
