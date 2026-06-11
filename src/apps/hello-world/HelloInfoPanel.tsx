import { useShellStore } from "../../shell/store";
import { commandBus } from "../../shell/commandBus";

/**
 * Right panel content — shows shell state and available commands.
 * Demonstrates reading the shell store from a panel component.
 */
export function HelloInfoPanel(_props: { params?: Record<string, string> }) {
  const activeAppId = useShellStore((s) => s.activeAppId);
  const leftNavCollapsed = useShellStore((s) => s.leftNavCollapsed);
  const rightPanelWidth = useShellStore((s) => s.rightPanelWidth);
  const bottomPanelId = useShellStore((s) => s.bottomPanelId);
  const theme = useShellStore((s) => s.theme);

  const registeredCommands = commandBus.listCommands();
  const activeEvents = commandBus.listEvents();

  return (
    <div className="hello-info-panel">
      <h3 className="hello-info-title">Shell State Inspector</h3>
      <p className="hello-info-description">
        This panel reads from the Zustand Shell Store (Tier 1) to display
        the current state of the chassis.
      </p>

      <div className="hello-info-section">
        <h4 className="hello-info-section-title">Layout State</h4>
        <div className="hello-info-grid">
          <InfoRow label="Active App" value={activeAppId ?? "none"} />
          <InfoRow label="Left Nav" value={leftNavCollapsed ? "collapsed" : "expanded"} />
          <InfoRow label="Right Panel Width" value={`${Math.round(rightPanelWidth)}px`} />
          <InfoRow label="Bottom Panel" value={bottomPanelId ?? "closed"} />
          <InfoRow label="Theme" value={theme} />
        </div>
      </div>

      <div className="hello-info-section">
        <h4 className="hello-info-section-title">Registered Commands</h4>
        <div className="hello-info-list">
          {registeredCommands.map((cmd) => (
            <code key={cmd} className="hello-info-command">{cmd}</code>
          ))}
        </div>
      </div>

      {activeEvents.length > 0 && (
        <div className="hello-info-section">
          <h4 className="hello-info-section-title">Active Event Listeners</h4>
          <div className="hello-info-list">
            {activeEvents.map((evt) => (
              <code key={evt} className="hello-info-command">{evt}</code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="hello-info-row">
      <span className="hello-info-label">{label}</span>
      <span className="hello-info-value">{value}</span>
    </div>
  );
}
