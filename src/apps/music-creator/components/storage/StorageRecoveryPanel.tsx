import {
  isRecoverableLoadError,
  STORAGE_ERROR_MESSAGES,
} from "../../constants/storageMessages";
import type { StorageErrorCode } from "../../types";

export interface StorageRecoveryPanelProps {
  errorCode: StorageErrorCode;
  onResetRequest: () => void;
}

/**
 * Fatal loadStore failure — blocks hub CRUD until storage is fixed or reset.
 * Recoverable codes offer Reset storage; unavailable shows guidance only.
 */
export function StorageRecoveryPanel({
  errorCode,
  onResetRequest,
}: StorageRecoveryPanelProps) {
  const canReset = isRecoverableLoadError(errorCode);

  return (
    <section
      className="music-creator-recovery-panel"
      aria-labelledby="music-creator-recovery-heading"
      role="alert"
    >
      <h2 id="music-creator-recovery-heading" className="music-creator-empty-title">
        Projects could not be loaded
      </h2>
      <p className="music-creator-muted">{STORAGE_ERROR_MESSAGES[errorCode]}</p>
      {canReset ? (
        <p className="music-creator-muted">
          You can reset storage to start fresh. Valid projects will be lost unless you have a
          backup elsewhere.
        </p>
      ) : (
        <p className="music-creator-muted">
          Try another browser profile or disable extensions that block storage, then reload.
        </p>
      )}
      {canReset ? (
        <button
          type="button"
          className="music-creator-btn music-creator-btn-danger"
          onClick={onResetRequest}
        >
          Reset storage…
        </button>
      ) : null}
    </section>
  );
}
