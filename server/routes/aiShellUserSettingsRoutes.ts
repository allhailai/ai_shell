/* ── AIShell user settings routes ────────────────────────────────────── */

import type { Express, Request, Response, NextFunction } from "express";
import {
  AiShellUserSettingsService,
  UserSettingsError,
  createPortableKeybindingExport,
  validatePortableKeybindingProfile,
} from "../services/aiShellUserSettingsService.js";

type HttpErrorFn = (message: string, status: number, code: string) => Error;

interface UserSettingsRoutesDeps {
  service: AiShellUserSettingsService;
  httpError: HttpErrorFn;
}

export function authenticatedUsername(req: Request, httpError: HttpErrorFn): string {
  if (!req.user?.username) throw httpError("Authentication required.", 401, "authentication_required");
  return req.user.username;
}

function wrap(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
}

export function registerAiShellUserSettingsRoutes(app: Express, deps: UserSettingsRoutesDeps): void {
  const { service, httpError } = deps;

  app.get("/api/user-settings", wrap(async (req, res) => {
    const result = await service.get(authenticatedUsername(req, httpError));
    res.setHeader("ETag", `"${result.revision}"`);
    res.json(result);
  }));

  app.put("/api/user-settings", wrap(async (req, res) => {
    const body = (req.body ?? {}) as { profile?: unknown; expectedRevision?: unknown };
    const result = await service.save(authenticatedUsername(req, httpError), body.profile, body.expectedRevision);
    res.setHeader("ETag", `"${result.revision}"`);
    res.json(result);
  }));

  app.get("/api/user-settings/keybindings/export", wrap(async (req, res) => {
    const result = await service.get(authenticatedUsername(req, httpError));
    const document = createPortableKeybindingExport(result.profile, new Date().toISOString());
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=aishell-keybindings.aishell-keybindings.json");
    res.send(JSON.stringify(document, null, 2) + "\n");
  }));

  app.post("/api/user-settings/keybindings/import/validate", wrap(async (req, res) => {
    const body = (req.body ?? {}) as { document?: unknown; mode?: unknown };
    const preview = await service.previewImport(authenticatedUsername(req, httpError), body.document, body.mode);
    res.json(preview);
  }));

  app.post("/api/user-settings/keybindings/import", wrap(async (req, res) => {
    const body = (req.body ?? {}) as {
      document?: unknown; mode?: unknown; confirmReplace?: unknown; expectedRevision?: unknown;
    };
    if (body.mode !== "merge" && body.mode !== "replace") {
      throw new UserSettingsError("Choose merge or replace for this import.", "invalid_import", 400);
    }
    if (body.mode === "replace" && body.confirmReplace !== true) {
      throw new UserSettingsError("Replace All requires explicit confirmation.", "replace_confirmation_required", 400);
    }
    // Validate the portable envelope before constructing the final profile.
    validatePortableKeybindingProfile(body.document);
    const actor = authenticatedUsername(req, httpError);
    const preview = await service.previewImport(actor, body.document, body.mode);
    if (preview.conflicting.length > 0) {
      throw new UserSettingsError("Resolve keybinding conflicts before importing.", "shortcut_conflict", 400);
    }
    const result = await service.save(actor, preview.profile, body.expectedRevision);
    res.setHeader("ETag", `"${result.revision}"`);
    res.json({ ...result, preview });
  }));
}
