/* ── CodaScope: Header Items ──────────────────────────────────────────
   Topbar injection for CodaScope — renders the Help button in the
   top bar's action area, right-aligned next to the panel toggles.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback } from "react";
import { useCommandBus } from "../../shell/hooks";
import { IconHelp } from "./components/CodaScopeIcons";

export function CodaScopeHeaderItems() {
  const commandBus = useCommandBus();

  const handleOpenGuide = useCallback(() => {
    commandBus?.emit("codascope:open-guide", {});
  }, [commandBus]);

  return (
    <button
      className="topbar-action-button"
      onClick={handleOpenGuide}
      type="button"
      title="Open CodaScope Guide"
    >
      <IconHelp size={14} />
      <span>CodaScope Help</span>
    </button>
  );
}
