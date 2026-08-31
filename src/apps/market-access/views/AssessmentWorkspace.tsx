import type { ReactNode } from "react";
import {
  IconAnalogs,
  IconEvidence,
  IconKnowledge,
} from "../components/MarketAccessIcons";
import {
  formatPackageFileSize,
  packageFormatLabel,
} from "../packageFile";
import type { Assessment } from "../types";

interface AssessmentWorkspaceProps {
  assessment: Assessment;
}

/** Workspace overview — product metadata and placeholder sections for later work. */
export function AssessmentWorkspace({ assessment }: AssessmentWorkspaceProps) {
  const { productName, packageFile } = assessment;

  return (
    <div
      className="market-access-page market-access-page-workspace"
      role="region"
      aria-labelledby="market-access-workspace-heading"
    >
      <header className="market-access-workspace-header">
        <h1 id="market-access-workspace-heading" className="market-access-title">
          {productName}
        </h1>
        <p className="market-access-session-note">
          This assessment is not saved to disk. Refreshing the browser will
          remove it.
        </p>
      </header>

      <section
        className="market-access-meta-panel"
        aria-labelledby="market-access-package-heading"
      >
        <h2 id="market-access-package-heading" className="market-access-section-title">
          Package
        </h2>
        <dl className="market-access-meta-list">
          <div className="market-access-meta-row">
            <dt className="market-access-meta-label">File</dt>
            <dd className="market-access-meta-value">{packageFile.fileName}</dd>
          </div>
          <div className="market-access-meta-row">
            <dt className="market-access-meta-label">Size</dt>
            <dd className="market-access-meta-value">
              {formatPackageFileSize(packageFile.fileSize)}
            </dd>
          </div>
          <div className="market-access-meta-row">
            <dt className="market-access-meta-label">Format</dt>
            <dd className="market-access-meta-value">
              {packageFormatLabel(packageFile.format)}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="market-access-sections-heading">
        <h2 id="market-access-sections-heading" className="market-access-section-title">
          Workspace
        </h2>
        <div className="market-access-placeholder-grid">
          <PlaceholderCard
            icon={<IconAnalogs size={22} />}
            title="Analogs"
            description="Identify and compare pharmaceutical analogs for this product. Research tools are not available yet."
          />
          <PlaceholderCard
            icon={<IconEvidence size={22} />}
            title="Evidence"
            description="Review source documents and provenance for claims. No evidence has been collected yet."
          />
          <PlaceholderCard
            icon={<IconKnowledge size={22} />}
            title="Knowledge"
            description="Structured knowledge extracted from sources will appear here. Nothing has been generated yet."
          />
        </div>
      </section>
    </div>
  );
}

function PlaceholderCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <article className="market-access-placeholder-card">
      <div className="market-access-placeholder-icon" aria-hidden>
        {icon}
      </div>
      <h3 className="market-access-placeholder-title">{title}</h3>
      <p className="market-access-placeholder-text">{description}</p>
      <p className="market-access-placeholder-badge">Coming later</p>
    </article>
  );
}
