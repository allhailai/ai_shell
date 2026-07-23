/* ── CodaScope: Shared Service Context ────────────────────────────────
   Singleton service instances, initialization, and shared helpers used
   by all CodaScope sub-route files.
   ──────────────────────────────────────────────────────────────────── */

import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import path from "node:path";
import type { SecretService } from "../services/secretService.js";
import type { AuthStrategy, User } from "../services/authService.js";
import { CodaScopeProjectService } from "../services/codaScopeProjectService.js";
import { CodaScopeProjectBundleService } from "../services/codaScopeProjectBundleService.js";
import { CodaScopeWikiService } from "../services/codaScopeWikiService.js";
import { CodaScopeChatService } from "../services/codaScopeChatService.js";
import { CodaScopeSkillService } from "../services/codaScopeSkillService.js";
import { CodaScopeAgentService } from "../services/codaScopeAgentService.js";
import { CodaScopeBuildStateService } from "../services/codaScopeBuildStateService.js";
import { CodaScopeCodeMapService } from "../services/codaScopeCodeMapService.js";

import { CodaScopeWikiStateService } from "../services/codaScopeWikiStateService.js";
import { CodaScopeEpicService } from "../services/codaScopeEpicService.js";
import { CodaScopeEpicBundleService } from "../services/codaScopeEpicBundleService.js";
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
import { CodaScopeNoteDocumentService } from "../services/codaScopeNoteDocumentService.js";
import {
  isPathValidationError,
  isSameOrDescendantPath,
} from "../services/codaScopePathSafety.js";
import { isPersistenceDomainError } from "../services/codaScopePersistence.js";
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
  /** Used only by the admin legacy-conversation migration to validate a target account. */
  authService: Pick<AuthStrategy, "getUser">;
  authMiddleware: Record<string, unknown>;
  httpError: HttpErrorFn;
  /** AIShell's checkout. Mutable CodaScope project data must not be stored below it. */
  repoRoot: string;
}

export interface CodaScopeServices {
  projectSvc: CodaScopeProjectService;
  projectBundleSvc: CodaScopeProjectBundleService;
  wikiSvc: CodaScopeWikiService;
  chatSvc: CodaScopeChatService;
  skillSvc: CodaScopeSkillService;
  agentSvc: CodaScopeAgentService;
  buildSvc: CodaScopeBuildStateService;
  codeMapSvc: CodaScopeCodeMapService;

  wikiStateSvc: CodaScopeWikiStateService;
  epicSvc: CodaScopeEpicService;
  epicBundleSvc: CodaScopeEpicBundleService;
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
  noteDocumentSvc: CodaScopeNoteDocumentService;
}

/** Everything a sub-route file needs to register its endpoints. */
export interface CodaScopeRouteContext {
  app: Express;
  secretService: SecretService;
  authService: Pick<AuthStrategy, "getUser">;
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

// ── Root-bound Service Graph ─────────────────────────────────────────────────

interface CodaScopeServiceGraph {
  root: string;
  services: CodaScopeServices;
}

let serviceGraph: CodaScopeServiceGraph | null = null;
let lifecycleQueue: Promise<void> = Promise.resolve();

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
  return isSameOrDescendantPath(repoRoot, candidate);
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
  return withLifecycleLock(async () => {
    const configuredRoot = await getProjectsRoot(secretService);
    if (!configuredRoot) throw httpError("CodaScope is not configured. Set the projects root first.", 400, "not_configured");
    assertProjectsRootOutsideInstall(configuredRoot, repoRoot, httpError);
    const root = path.resolve(configuredRoot);
    if (serviceGraph?.root === root) return serviceGraph.services;

    const candidate = createServiceGraph(secretService, root);
    try {
      await candidate.services.projectSvc.ensureRootExists();
    } catch (error) {
      await disposeServiceGraph(candidate);
      throw error;
    }

    const previous = serviceGraph;
    if (previous) await disposeServiceGraph(previous);
    serviceGraph = candidate;
    return candidate.services;
  });
}

/**
 * Persist and atomically cut over to a new projects root. Requests trying to
 * resolve services while this runs wait for the complete new graph.
 */
export async function changeProjectsRoot(
  secretService: SecretService,
  newRoot: string,
  httpError: HttpErrorFn,
  repoRoot: string,
): Promise<CodaScopeServices> {
  return withLifecycleLock(async () => {
    const root = path.resolve(newRoot);
    assertProjectsRootOutsideInstall(root, repoRoot, httpError);
    const previousConfiguredRoot = await getProjectsRoot(secretService);
    if (serviceGraph?.root === root) {
      await serviceGraph.services.projectSvc.ensureRootExists();
      await setProjectsRoot(secretService, root);
      return serviceGraph.services;
    }

    // Construct and verify the entire replacement graph before changing the
    // durable configuration or invalidating the currently live graph.
    const candidate = createServiceGraph(secretService, root);
    let persisted = false;
    try {
      await candidate.services.projectSvc.ensureRootExists();
      await setProjectsRoot(secretService, root);
      persisted = true;
      const effectiveRoot = await getProjectsRoot(secretService);
      if (!effectiveRoot || path.resolve(effectiveRoot) !== root) {
        throw httpError(
          "Projects root is managed by an environment override and cannot be changed at runtime.",
          409,
          "projects_root_managed_externally",
        );
      }
    } catch (error) {
      await disposeServiceGraph(candidate);
      if (persisted) {
        try {
          if (previousConfiguredRoot) await setProjectsRoot(secretService, previousConfiguredRoot);
          else await secretService.deleteAppSecret(APP_ID, CONFIG_KEY);
        } catch (rollbackError) {
          throw httpError(
            `Projects-root update failed and its configuration rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            500,
            "projects_root_rollback_failed",
          );
        }
      }
      throw error;
    }

    const previous = serviceGraph;
    try {
      if (previous) await disposeServiceGraph(previous);
      serviceGraph = candidate;
      return candidate.services;
    } catch (error) {
      await disposeServiceGraph(candidate);
      serviceGraph = null;
      throw httpError(
        `Projects root was saved but the service cutover failed: ${error instanceof Error ? error.message : String(error)}`,
        500,
        "projects_root_cutover_failed",
      );
    }
  });
}

/** Dispose all root-bound state. Also used by graceful shutdown and tests. */
export async function shutdownCodaScopeServices(): Promise<void> {
  await withLifecycleLock(async () => {
    const previous = serviceGraph;
    serviceGraph = null;
    if (previous) await disposeServiceGraph(previous);
  });
}

function createServiceGraph(secretService: SecretService, root: string): CodaScopeServiceGraph {
  const projectSvc = new CodaScopeProjectService(root);
  const dirResolver = new ProjectDirResolver(root);
  projectSvc.setDirResolver(dirResolver);

  const wikiSvc = new CodaScopeWikiService(root);
  const chatSvc = new CodaScopeChatService(root);
  const skillSvc = new CodaScopeSkillService(root);
  const buildSvc = new CodaScopeBuildStateService(root);
  const codeMapSvc = new CodaScopeCodeMapService(root);
  const wikiStateSvc = new CodaScopeWikiStateService(root);
  const epicSvc = new CodaScopeEpicService(root);
  const designDocSvc = new CodaScopeDesignDocService(root);
  const versionSvc = new CodaScopeVersionService(root);
  const annotationSvc = new CodaScopeAnnotationService(root);
  const renderSvc = new CodaScopeEpicRenderService(root);
  const epicKnowledgeSvc = new CodaScopeEpicKnowledgeService(root);
  const curationSvc = new CodaScopeCurationService(root);
  const contentSvc = new CodaScopeContentService();
  const imageSvc = new CodaScopeImageService(root, chatSvc);
  const artifactSvc = new CodaScopeArtifactService(root);
  const artifactAnnotationSvc = new CodaScopeArtifactAnnotationService(root);
  const artifactVersionSvc = new CodaScopeArtifactVersionService(root);
  const lockSvc = new CodaScopeLockService(root);
  const directiveSvc = new CodaScopeDirectiveService(root);
  const noteSvc = new CodaScopeNoteService(root, dirResolver);
  const noteAnnotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
  const noteBundleSvc = new CodaScopeNoteBundleService(noteSvc, noteAnnotationSvc);
  const noteAuditSvc = new CodaScopeNoteAuditService(root);
  const noteUserPrefsSvc = new CodaScopeNoteUserPrefsService(root);
  const noteDocumentSvc = new CodaScopeNoteDocumentService(noteSvc, noteUserPrefsSvc);
  const noteLinkIndexSvc = new CodaScopeNoteLinkIndexService(noteSvc);
  const noteExportSvc = new CodaScopeNoteExportService(root, noteSvc, noteAuditSvc, noteBundleSvc);
  const noteImportSvc = new CodaScopeNoteImportService(root, noteSvc, noteAuditSvc, noteBundleSvc);
  const noteTagSuggestionSvc = new CodaScopeNoteTagSuggestionService(root);
  const noteTransferSvc = new CodaScopeNoteTransferService(
    noteSvc,
    noteBundleSvc,
    noteUserPrefsSvc,
    noteLinkIndexSvc,
    noteAuditSvc,
  );
  // Construct the one timer-owning service last so an earlier constructor
  // failure cannot strand an untracked cleanup interval.
  const agentSvc = new CodaScopeAgentService(secretService, root);

  return {
    root,
    services: {
      projectSvc,
      projectBundleSvc: new CodaScopeProjectBundleService(projectSvc),
      wikiSvc,
      chatSvc,
      skillSvc,
      agentSvc,
      buildSvc,
      codeMapSvc,
      wikiStateSvc,
      epicSvc,
      epicBundleSvc: new CodaScopeEpicBundleService(projectSvc),
      designDocSvc,
      versionSvc,
      annotationSvc,
      renderSvc,
      epicKnowledgeSvc,
      curationSvc,
      contentSvc,
      imageSvc,
      artifactSvc,
      artifactAnnotationSvc,
      artifactVersionSvc,
      lockSvc,
      directiveSvc,
      noteSvc,
      noteAnnotationSvc,
      noteBundleSvc,
      noteAuditSvc,
      noteUserPrefsSvc,
      noteLinkIndexSvc,
      noteExportSvc,
      noteImportSvc,
      noteTagSuggestionSvc,
      noteTransferSvc,
      noteDocumentSvc,
    },
  };
}

async function disposeServiceGraph(graph: CodaScopeServiceGraph): Promise<void> {
  graph.services.buildSvc.dispose();
  graph.services.noteExportSvc.dispose();
  await graph.services.agentSvc.shutdown();
}

function withLifecycleLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = lifecycleQueue.then(operation, operation);
  lifecycleQueue = result.then(() => undefined, () => undefined);
  return result;
}

// ── Exported: agentService accessor (used by validate-api-key route) ─

export function getAgentServiceSingleton(): CodaScopeAgentService | null {
  return serviceGraph?.services.agentSvc ?? null;
}

// ── Route Context Factory ───────────────────────────────────────────

/** Build a CodaScopeRouteContext from the raw deps — called once in the hub. */
export function createRouteContext(app: Express, deps: CodaScopeRoutesDeps): CodaScopeRouteContext {
  const { secretService, authService, httpError, repoRoot } = deps;

  const wrap = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler => {
    return (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch((error: unknown) => {
        if (isPathValidationError(error)) {
          next(httpError(error.message, 400, "invalid_input"));
          return;
        }
        if (isPersistenceDomainError(error)) {
          const { storage, projectId, epicId, documentId, recovery } = error.context;
          console.error("[CodaScope] persistence boundary failure", {
            code: error.code,
            context: { storage, projectId, epicId, documentId, recovery },
          });
          next(httpError(error.message, error.status, error.code));
          return;
        }
        next(error);
      });
    };
  };

  return {
    app,
    secretService,
    authService,
    httpError,
    repoRoot,
    ensureServices: () => ensureServicesImpl(secretService, httpError, repoRoot),
    wrap,
    param,
    principal: (req) => principal(req, httpError),
    upload: uploadInstance,
  };
}
