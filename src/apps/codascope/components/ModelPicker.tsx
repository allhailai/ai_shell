/* ── CodaScope: Model Picker ──────────────────────────────────────────
   Compact model selector dropdown. Fetches available models from the
   Cursor API and remembers the last selection in localStorage.

   Two usage modes:
   1. Self-fetching: <ModelPicker value={id} onChange={fn} />
   2. Controlled:    <ModelPicker models={list} selectedModelId={id} onSelect={fn} />
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback } from "react";

export interface ModelInfo {
  id: string;
  displayName: string;
  description?: string;
}

const STORAGE_KEY = "codascope:lastModel";

function getLastModel(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function setLastModel(modelId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, modelId);
  } catch {
    // ignore
  }
}

/**
 * Deterministically pick the latest Composer model from a list.
 * Parses version numbers from model IDs matching `composer-*`
 * (e.g., "composer-2.5" → 2.5) and returns the highest version.
 */
function pickLatestComposer(models: ModelInfo[]): ModelInfo | null {
  const composerModels = models
    .map((m) => {
      // Match IDs like "composer-2.5", "composer-3", "composer-2-5"
      const match = m.id.match(/^composer[- ]?([\d]+(?:[.\-][\d]+)*)/i)
        ?? m.displayName.match(/^composer\s*([\d]+(?:[.\-][\d]+)*)/i);
      if (!match) return null;
      // Normalize "2-5" → "2.5" then parse as float for comparison
      const version = parseFloat(match[1].replace(/-/g, "."));
      return { model: m, version };
    })
    .filter((x): x is { model: ModelInfo; version: number } => x !== null);

  if (composerModels.length === 0) return null;

  // Sort descending by version, return the highest
  composerModels.sort((a, b) => b.version - a.version);
  return composerModels[0].model;
}

/**
 * Hook that manages model fetching and selection.
 */
export function useModelPicker() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>(getLastModel() ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/codascope/models")
      .then((r) => r.json())
      .then((data: { models?: ModelInfo[]; error?: string }) => {
        if (cancelled) return;
        const fetchedModels = data.models ?? [];
        setModels(fetchedModels);
        if (data.error) setError(data.error);

        // Auto-select priority:
        // 1. Last used model (from localStorage) — unless it's the generic "default"
        // 2. Latest Composer model (deterministic: highest version number)
        // 3. First model in list
        if (fetchedModels.length > 0) {
          const last = getLastModel();
          // Treat "default" as no preference — upgrade to latest Composer
          const isGenericDefault = !last || last === "default";
          const found = isGenericDefault ? null : fetchedModels.find((m) => m.id === last);
          if (found) {
            setSelectedModelId(found.id);
          } else {
            const defaultModel = pickLatestComposer(fetchedModels) ?? fetchedModels[0];
            setSelectedModelId(defaultModel.id);
            setLastModel(defaultModel.id);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectModel = useCallback((modelId: string) => {
    setSelectedModelId(modelId);
    setLastModel(modelId);
  }, []);

  return { models, selectedModelId, selectModel, loading, error };
}

/* ── Controlled ModelPicker (models provided externally) ──────────── */

interface ControlledProps {
  models: ModelInfo[];
  selectedModelId: string;
  onSelect: (modelId: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

/* ── Self-fetching ModelPicker ────────────────────────────────────── */

interface SelfFetchProps {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

type ModelPickerProps = ControlledProps | SelfFetchProps;

function isControlled(props: ModelPickerProps): props is ControlledProps {
  return "models" in props;
}

/**
 * Compact model picker component.
 * Supports both controlled (models prop) and self-fetching (value/onChange) modes.
 */
export function ModelPicker(props: ModelPickerProps) {
  if (isControlled(props)) {
    return <ControlledModelPicker {...props} />;
  }
  return <SelfFetchingModelPicker {...props} />;
}

function ControlledModelPicker({
  models,
  selectedModelId,
  onSelect,
  disabled,
  compact,
}: ControlledProps) {
  if (models.length === 0) {
    return (
      <span className="codascope-model-picker-empty">
        {disabled ? "Set API key first" : "No models"}
      </span>
    );
  }

  return (
    <select
      className={`codascope-model-picker${compact ? " codascope-model-picker-compact" : ""}`}
      value={selectedModelId}
      onChange={(e) => onSelect(e.target.value)}
      disabled={disabled}
      aria-label="Select AI model"
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.displayName}
        </option>
      ))}
    </select>
  );
}

function SelfFetchingModelPicker({
  value,
  onChange,
  disabled,
  compact,
}: SelfFetchProps) {
  const { models, selectedModelId, selectModel } = useModelPicker();

  // Sync the external value with internal state
  useEffect(() => {
    if (selectedModelId && selectedModelId !== value) {
      onChange(selectedModelId);
    }
  }, [selectedModelId, value, onChange]);

  const handleChange = useCallback(
    (modelId: string) => {
      selectModel(modelId);
      onChange(modelId);
    },
    [selectModel, onChange],
  );

  if (models.length === 0) {
    return (
      <span className="codascope-model-picker-empty">
        {disabled ? "Set API key first" : "Loading models…"}
      </span>
    );
  }

  return (
    <select
      className={`codascope-model-picker${compact ? " codascope-model-picker-compact" : ""}`}
      value={value || selectedModelId}
      onChange={(e) => handleChange(e.target.value)}
      disabled={disabled}
      aria-label="Select AI model"
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.displayName}
        </option>
      ))}
    </select>
  );
}
