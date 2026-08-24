import type { ReactNode } from "react";
import { useShellStore } from "../../shell/store";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import {
  IconAnalogs,
  IconAssessments,
  IconEvidence,
  IconKnowledge,
  IconNew,
  IconOverview,
} from "./components/MarketAccessIcons";

const APP_ID = "market-access";

/**
 * URL-only left nav. Product name stays in the canvas — this region
 * cannot receive props from mainContent.
 */
export function MarketAccessNav() {
  const collapsed = useShellStore((s) => s.leftNavCollapsed);
  const { segments, navigate } = useAppSubRoute(APP_ID);

  const section = segments[0] ?? "";
  const id = segments[1] ?? "";
  const onList = section === "" || (section === "assessments" && !id);
  const onCreate = section === "assessments" && id === "new";
  const onWorkspace = section === "assessments" && id !== "" && id !== "new";

  return (
    <nav className="market-access-nav" aria-label="Market Access">
      <div className="market-access-nav-content scrollable-y">
        <button
          type="button"
          className={`nav-item${onList ? " active" : ""}`}
          aria-current={onList ? "page" : undefined}
          title={collapsed ? "All assessments" : undefined}
          onClick={() => navigate("assessments")}
        >
          <span className="nav-item-icon" aria-hidden>
            <IconAssessments />
          </span>
          <span className="nav-item-label">All assessments</span>
        </button>

        {onCreate ? (
          <>
            <div className="nav-divider" aria-hidden />
            <div
              className="nav-item active"
              aria-current="page"
              title={collapsed ? "New assessment" : undefined}
            >
              <span className="nav-item-icon" aria-hidden>
                <IconNew />
              </span>
              <span className="nav-item-label">New assessment</span>
            </div>
          </>
        ) : null}

        {onWorkspace ? (
          <>
            <div className="nav-divider" aria-hidden />
            <button
              type="button"
              className="nav-item active"
              aria-current="page"
              title={collapsed ? "Overview" : undefined}
              onClick={() => navigate(`assessments/${id}`)}
            >
              <span className="nav-item-icon" aria-hidden>
                <IconOverview />
              </span>
              <span className="nav-item-label">Overview</span>
            </button>
            <DisabledNavItem
              collapsed={collapsed}
              label="Analogs"
              icon={<IconAnalogs />}
            />
            <DisabledNavItem
              collapsed={collapsed}
              label="Evidence"
              icon={<IconEvidence />}
            />
            <DisabledNavItem
              collapsed={collapsed}
              label="Knowledge"
              icon={<IconKnowledge />}
            />
          </>
        ) : null}
      </div>
    </nav>
  );
}

function DisabledNavItem({
  collapsed,
  label,
  icon,
}: {
  collapsed: boolean;
  label: string;
  icon: ReactNode;
}) {
  const title = collapsed ? `${label} (coming later)` : "Coming later";
  return (
    <button type="button" className="nav-item" disabled title={title}>
      <span className="nav-item-icon" aria-hidden>
        {icon}
      </span>
      <span className="nav-item-label">{label}</span>
    </button>
  );
}
