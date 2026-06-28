/* ── CodaScope: Model Picker ──────────────────────────────────────────
   Compact model selector dropdown. Fetches available models from the
   Cursor API and remembers the last selection in localStorage.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback } from "react";

interface ModelInfo {
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

        // Auto-select: last used model, or first in list
        if (fetchedModels.length > 0) {
          const last = getLastModel();
          const found = fetchedModels.find((m) => m.id === last);
          if (found) {
            setSelectedModelId(found.id);
          } else {
            setSelectedModelId(fetchedModels[0].id);
            setLastModel(fetchedModels[0].id);
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

/**
 * Compact model picker component.
 */
export function ModelPicker({
  models,
  selectedModelId,
  onSelect,
  disabled,
  compact,
}: {
  models: ModelInfo[];
  selectedModelId: string;
  onSelect: (modelId: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
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
