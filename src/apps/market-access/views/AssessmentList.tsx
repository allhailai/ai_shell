import { IconAssessments } from "../components/MarketAccessIcons";
import { packageFormatLabel } from "../packageFile";
import type { Assessment } from "../types";

interface AssessmentListProps {
  assessments: Assessment[];
  flashMessage: string | null;
  onDismissFlash: () => void;
  onCreate: () => void;
  onOpen: (assessmentId: string) => void;
}

/** Assessments hub — empty state or same-session in-memory cards. */
export function AssessmentList({
  assessments,
  flashMessage,
  onDismissFlash,
  onCreate,
  onOpen,
}: AssessmentListProps) {
  const sorted = [...assessments].sort((a, b) => b.createdAt - a.createdAt);
  const hasAssessments = sorted.length > 0;

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

      <header className="market-access-list-header">
        <h1 id="market-access-list-heading" className="market-access-title">
          Assessments
        </h1>
        <p className="market-access-session-note">
          Assessments exist only for this browser session. Nothing is saved to
          disk yet — refreshing the page will clear them.
        </p>
      </header>

      <div className="market-access-actions">
        <button
          type="button"
          className="market-access-btn market-access-btn-primary"
          onClick={onCreate}
        >
          Create assessment
        </button>
      </div>

      {hasAssessments ? (
        <section aria-labelledby="market-access-assessment-list-heading">
          <h2
            id="market-access-assessment-list-heading"
            className="market-access-section-title"
          >
            Your assessments
          </h2>
          <ul className="market-access-assessment-list">
            {sorted.map((assessment) => (
              <li key={assessment.id}>
                <article className="market-access-assessment-card">
                  <button
                    type="button"
                    className="market-access-assessment-card-open"
                    onClick={() => onOpen(assessment.id)}
                  >
                    <span className="market-access-assessment-card-name">
                      {assessment.productName}
                    </span>
                    <span className="market-access-assessment-card-meta">
                      {assessment.packageFile.fileName} ·{" "}
                      {packageFormatLabel(assessment.packageFile.format)}
                    </span>
                  </button>
                </article>
              </li>
            ))}
          </ul>
        </section>
      ) : (
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
            Create an assessment for one product or asset. Attach a Markdown,
            Word, or PowerPoint package to research pharmaceutical analogs.
          </p>
        </section>
      )}
    </div>
  );
}
