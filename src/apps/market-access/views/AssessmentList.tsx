import { IconAssessments } from "../components/MarketAccessIcons";

interface AssessmentListProps {
  flashMessage: string | null;
  onDismissFlash: () => void;
  onCreate: () => void;
}

/** Assessments hub — empty state until in-memory cards land in Phase 4. */
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

      <section
        className="market-access-empty"
        aria-labelledby="market-access-empty-heading"
      >
        <div className="market-access-empty-icon" aria-hidden>
          <IconAssessments size={48} />
        </div>
        <h2 id="market-access-empty-heading" className="market-access-empty-title">
          No assessments yet
        </h2>
        <p className="market-access-empty-text">
          Create an assessment for one product or asset. Attach a Markdown or
          Word package to research pharmaceutical analogs. Nothing is saved to
          disk yet — assessments exist only for this browser session.
        </p>
        <button
          type="button"
          className="market-access-btn market-access-btn-primary"
          onClick={onCreate}
        >
          Create assessment
        </button>
      </section>
    </div>
  );
}
