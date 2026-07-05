/* ── CodaScope: ScopeDiffModal ────────────────────────────────────────
   Modal for reviewing scope changes proposed by the agent.
   Shows additions, removals, depth changes, and unchanged items.
   Users can toggle acceptance of individual changes before applying.
   Extracted from EpicScope.tsx.
   ──────────────────────────────────────────────────────────────────── */

import type { ScopeDiff } from "../codaScopeTypes";
import { DepthBadge, TypeBadge } from "./ScopeBadges";

/* ── Props ────────────────────────────────────────────────────────────── */

interface ScopeDiffModalProps {
  diff: ScopeDiff;
  accepted: { added: Set<string>; removed: Set<string>; changed: Set<string> };
  onToggle: (category: "added" | "removed" | "changed", id: string) => void;
  onApply: () => void;
  onDismiss: () => void;
}

/* ── Component ────────────────────────────────────────────────────────── */

export function ScopeDiffModal({
  diff,
  accepted,
  onToggle,
  onApply,
  onDismiss,
}: ScopeDiffModalProps) {
  const totalChanges = diff.added.length + diff.removed.length + diff.changed.length;
  const totalAccepted = accepted.added.size + accepted.removed.size + accepted.changed.size;

  return (
    <div className="codascope-modal-overlay" onClick={onDismiss}>
      <div className="codascope-scope-diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="codascope-scope-diff-header">
          <h3>Review Scope Changes</h3>
          <span className="codascope-scope-diff-summary">
            {totalChanges} change{totalChanges !== 1 ? "s" : ""} · {totalAccepted} accepted
          </span>
          <button className="codascope-modal-close" onClick={onDismiss} type="button">×</button>
        </div>

        <div className="codascope-scope-diff-body">
          {/* Added */}
          {diff.added.length > 0 && (
            <div className="codascope-scope-diff-section">
              <h4 className="codascope-scope-diff-section-title codascope-scope-diff-added-title">
                Added ({diff.added.length})
              </h4>
              {diff.added.map((entry) => (
                <label
                  key={entry.topicId}
                  className="codascope-scope-diff-item codascope-scope-diff-item--added"
                >
                  <input
                    type="checkbox"
                    checked={accepted.added.has(entry.topicId)}
                    onChange={() => onToggle("added", entry.topicId)}
                  />
                  <div className="codascope-scope-diff-item-info">
                    <span className="codascope-scope-diff-item-title">{entry.topicTitle}</span>
                    <TypeBadge type={entry.type} />
                    {entry.targetDepth && <DepthBadge depth={entry.targetDepth} />}
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Removed */}
          {diff.removed.length > 0 && (
            <div className="codascope-scope-diff-section">
              <h4 className="codascope-scope-diff-section-title codascope-scope-diff-removed-title">
                Removed ({diff.removed.length})
              </h4>
              {diff.removed.map((topicId) => (
                <label
                  key={topicId}
                  className="codascope-scope-diff-item codascope-scope-diff-item--removed"
                >
                  <input
                    type="checkbox"
                    checked={accepted.removed.has(topicId)}
                    onChange={() => onToggle("removed", topicId)}
                  />
                  <div className="codascope-scope-diff-item-info">
                    <span className="codascope-scope-diff-item-title">{topicId}</span>
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Changed */}
          {diff.changed.length > 0 && (
            <div className="codascope-scope-diff-section">
              <h4 className="codascope-scope-diff-section-title codascope-scope-diff-changed-title">
                Depth Changes ({diff.changed.length})
              </h4>
              {diff.changed.map((change) => (
                <label
                  key={change.topicId}
                  className="codascope-scope-diff-item codascope-scope-diff-item--changed"
                >
                  <input
                    type="checkbox"
                    checked={accepted.changed.has(change.topicId)}
                    onChange={() => onToggle("changed", change.topicId)}
                  />
                  <div className="codascope-scope-diff-item-info">
                    <span className="codascope-scope-diff-item-title">{change.topicId}</span>
                    <div className="codascope-scope-diff-depth-change">
                      <DepthBadge depth={change.oldTargetDepth} />
                      <span className="codascope-scope-depth-arrow">→</span>
                      <DepthBadge depth={change.newTargetDepth} />
                    </div>
                    <span className="codascope-scope-diff-reason">{change.reason}</span>
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Unchanged */}
          {diff.unchanged.length > 0 && (
            <div className="codascope-scope-diff-section codascope-scope-diff-unchanged-section">
              <h4 className="codascope-scope-diff-section-title">
                Unchanged ({diff.unchanged.length})
              </h4>
              <div className="codascope-scope-diff-unchanged-list">
                {diff.unchanged.map((id) => (
                  <span key={id} className="codascope-scope-diff-unchanged-tag">{id}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="codascope-scope-diff-footer">
          <button
            className="codascope-btn codascope-btn-ghost"
            onClick={onDismiss}
            type="button"
          >
            Dismiss
          </button>
          <button
            className="codascope-btn codascope-btn-primary"
            onClick={onApply}
            disabled={totalAccepted === 0}
            type="button"
          >
            Apply {totalAccepted} Change{totalAccepted !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
