interface CreateAssessmentProps {
  onCancel: () => void;
}

/** Create-route shell — the form lands in the next PR 1 phase. */
export function CreateAssessment({ onCancel }: CreateAssessmentProps) {
  return (
    <div
      className="market-access-page"
      role="region"
      aria-labelledby="market-access-create-heading"
    >
      <h1 id="market-access-create-heading" className="market-access-title">
        Create assessment
      </h1>
      <p className="market-access-subtitle">
        Product name and package file selection will be added next.
      </p>
      <div className="market-access-actions">
        <button
          type="button"
          className="market-access-btn market-access-btn-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
