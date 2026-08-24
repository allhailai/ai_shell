interface AssessmentListProps {
  flashMessage: string | null;
  onDismissFlash: () => void;
  onCreate: () => void;
}

/** List shell — empty-state copy and cards land in later PR 1 phases. */
export function AssessmentList({
  flashMessage,
  onDismissFlash,
  onCreate,
}: AssessmentListProps) {
  return (
    <div
      className="market-access-page"
      role="region"
      aria-labelledby="market-access-list-heading"
    >
      {flashMessage ? (
        <div className="market-access-banner" role="status">
          <p className="market-access-banner-text">{flashMessage}</p>
          <button
            type="button"
            className="market-access-btn market-access-btn-ghost"
            onClick={onDismissFlash}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <h1 id="market-access-list-heading" className="market-access-title">
        Assessments
      </h1>
      <p className="market-access-subtitle">
        Create an assessment for one product or asset. Nothing is saved to disk
        yet.
      </p>
      <div className="market-access-actions">
        <button
          type="button"
          className="market-access-btn market-access-btn-primary"
          onClick={onCreate}
        >
          Create assessment
        </button>
      </div>
    </div>
  );
}
