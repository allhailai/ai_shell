/* ── CodaScope: ArtifactSpecEditor ────────────────────────────────────
   Spec authoring UI for visual HTML artifacts.
   Renders title, model selector, markdown body, source hints, and
   build controls with staleness indicators.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect } from "react";
import type { ArtifactSpec } from "../../codaScopeTypes.js";
import { ModelPicker } from "../ModelPicker";
import { IconBolt, IconDownload, IconWarning } from "../CodaScopeIcons";

interface ArtifactSpecEditorProps {
  artifact: ArtifactSpec;
  onSave: (updates: {
    title?: string;
    body?: string;
    modelId?: string | null;
    sources?: string[];
    autoDiscoverContext?: boolean;
  }) => Promise<void>;
  onBuild: () => void;
  onDownloadHtml: () => void;
  onDownloadSpec: () => void;
  building: boolean;
  saving: boolean;
}

export function ArtifactSpecEditor({
  artifact,
  onSave,
  onBuild,
  onDownloadHtml,
  onDownloadSpec,
  building,
  saving,
}: ArtifactSpecEditorProps) {
  const [title, setTitle] = useState(artifact.title);
  const [body, setBody] = useState(artifact.body);
  const [modelId, setModelId] = useState(artifact.modelId ?? "");
  const [autoDiscover, setAutoDiscover] = useState(artifact.autoDiscoverContext);
  const [sourcesText, setSourcesText] = useState(artifact.sources.join("\n"));

  // Sync when artifact prop changes (e.g., after external save)
  useEffect(() => {
    setTitle(artifact.title);
    setBody(artifact.body);
    setModelId(artifact.modelId ?? "");
    setAutoDiscover(artifact.autoDiscoverContext);
    setSourcesText(artifact.sources.join("\n"));
  }, [artifact.id]); // re-sync on artifact change, not every prop update

  const hasChanges =
    title !== artifact.title ||
    body !== artifact.body ||
    modelId !== (artifact.modelId ?? "") ||
    autoDiscover !== artifact.autoDiscoverContext ||
    sourcesText !== artifact.sources.join("\n");

  const isStale =
    artifact.buildSpecHash != null &&
    artifact.currentSpecHash != null &&
    artifact.buildSpecHash !== artifact.currentSpecHash;

  const handleSave = useCallback(async () => {
    const sources = sourcesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    await onSave({
      title: title.trim() || artifact.title,
      body,
      modelId: modelId || null,
      sources,
      autoDiscoverContext: autoDiscover,
    });
  }, [title, body, modelId, autoDiscover, sourcesText, onSave, artifact.title]);

  return (
    <div className="codascope-artifact-spec-editor">
      {/* Title */}
      <div className="codascope-artifact-spec-field">
        <label className="codascope-artifact-spec-label" htmlFor="artifact-title">
          Title
        </label>
        <input
          id="artifact-title"
          className="codascope-artifact-spec-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Artifact title"
        />
      </div>

      {/* Model selector */}
      <div className="codascope-artifact-spec-field">
        <label className="codascope-artifact-spec-label">Model</label>
        <ModelPicker value={modelId} onChange={setModelId} compact />
      </div>

      {/* Body editor */}
      <div className="codascope-artifact-spec-field codascope-artifact-spec-field-grow">
        <label className="codascope-artifact-spec-label" htmlFor="artifact-body">
          Spec Body
          <span className="codascope-artifact-spec-hint">
            Goals, content guidance, visualization preferences
          </span>
        </label>
        <textarea
          id="artifact-body"
          className="codascope-artifact-spec-textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Describe what this artifact should contain…"
          rows={12}
        />
      </div>

      {/* Source context */}
      <div className="codascope-artifact-spec-field">
        <label className="codascope-artifact-spec-label">
          Source Context
        </label>
        <div className="codascope-artifact-spec-toggle-row">
          <label className="codascope-artifact-spec-toggle">
            <input
              type="checkbox"
              checked={autoDiscover}
              onChange={(e) => setAutoDiscover(e.target.checked)}
            />
            <span>Auto-discover epic context</span>
          </label>
        </div>
        <textarea
          className="codascope-artifact-spec-textarea codascope-artifact-spec-sources"
          value={sourcesText}
          onChange={(e) => setSourcesText(e.target.value)}
          placeholder="Manual source hints (one per line: wiki topic IDs, file paths)"
          rows={3}
        />
      </div>

      {/* Actions bar */}
      <div className="codascope-artifact-spec-actions">
        {/* Staleness warning */}
        {isStale && (
          <span className="codascope-artifact-spec-stale" title="Spec has changed since last build">
            <IconWarning size={14} /> Stale
          </span>
        )}

        {/* Save */}
        <button
          className="codascope-artifact-spec-btn codascope-artifact-spec-btn-secondary"
          onClick={() => void handleSave()}
          disabled={saving || !hasChanges}
          type="button"
        >
          {saving ? "Saving…" : "Save"}
        </button>

        {/* Download buttons */}
        {artifact.status === "built" && (
          <button
            className="codascope-artifact-spec-btn codascope-artifact-spec-btn-secondary"
            onClick={onDownloadHtml}
            title="Download built HTML"
            type="button"
          >
            <IconDownload size={14} /> HTML
          </button>
        )}
        <button
          className="codascope-artifact-spec-btn codascope-artifact-spec-btn-secondary"
          onClick={onDownloadSpec}
          title="Download spec"
          type="button"
        >
          <IconDownload size={14} /> Spec
        </button>

        {/* Build */}
        <button
          className="codascope-artifact-spec-btn codascope-artifact-spec-btn-primary"
          onClick={onBuild}
          disabled={building}
          type="button"
        >
          <IconBolt size={14} />
          {building ? "Building…" : "Build"}
        </button>
      </div>
    </div>
  );
}
