import { useRightPanel, useBottomPanel, useCommandBus } from "../../shell/hooks";
import { useShellStore } from "../../shell/store";
import { useCallback, useState } from "react";

/**
 * Hello World demo plugin — main page.
 * Demonstrates: panel toggles, command bus invocation, sub-route linking, URL state.
 */
export function HelloPage() {
  const rightPanel = useRightPanel("hello-info");
  const bottomPanel = useBottomPanel("hello-log");
  const bus = useCommandBus();
  const [greetResult, setGreetResult] = useState<string | null>(null);
  const [greetName, setGreetName] = useState("World");

  const handleGreet = useCallback(async () => {
    try {
      const result = await bus.invoke<string>("hello.greet", greetName);
      setGreetResult(result);
      bus.emit("hello.activity", { type: "greet", name: greetName, result });
    } catch (err) {
      setGreetResult(`Error: ${err}`);
    }
  }, [bus, greetName]);

  const navigateToAbout = useCallback(() => {
    useShellStore.getState().setActivePlugin("hello");
    // Update path for sub-route
    window.history.pushState(null, "", "/hello/about" + window.location.search);
    // Force re-render by dispatching popstate
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  return (
    <div className="hello-page">
      <div className="hello-hero">
        <div className="hello-hero-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
            <line x1="12" y1="2" x2="12" y2="12" />
          </svg>
        </div>
        <h1 className="hello-title">Hello World Plugin</h1>
        <p className="hello-description">
          This demo plugin exercises every AIShell chassis capability: canvas pages,
          sub-routes, right panel, bottom panel, and the command bus.
        </p>
      </div>

      {/* Panel controls */}
      <div className="hello-section">
        <h2 className="hello-section-title">Panel Controls</h2>
        <div className="hello-button-row">
          <button
            className={`hello-button${rightPanel.isOpen ? " hello-button-active" : ""}`}
            onClick={rightPanel.toggle}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
            {rightPanel.isOpen ? "Close Info Panel" : "Open Info Panel"}
          </button>
          <button
            className={`hello-button${bottomPanel.isOpen ? " hello-button-active" : ""}`}
            onClick={bottomPanel.toggle}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="15" x2="21" y2="15" />
            </svg>
            {bottomPanel.isOpen ? "Close Activity Log" : "Open Activity Log"}
          </button>
        </div>
      </div>

      {/* Command bus demo */}
      <div className="hello-section">
        <h2 className="hello-section-title">Command Bus Demo</h2>
        <p className="hello-section-description">
          Type a name and invoke the <code>hello.greet</code> command.
          The result demonstrates request/response via the command bus.
          Open the Activity Log panel to see events.
        </p>
        <div className="hello-command-row">
          <input
            className="hello-input"
            type="text"
            value={greetName}
            onChange={(e) => setGreetName(e.target.value)}
            placeholder="Enter a name..."
            onKeyDown={(e) => { if (e.key === "Enter") void handleGreet(); }}
          />
          <button className="hello-button hello-button-accent" onClick={handleGreet} type="button">
            Invoke hello.greet
          </button>
        </div>
        {greetResult && (
          <div className="hello-result">
            <span className="hello-result-label">Result:</span>
            <span className="hello-result-value">{greetResult}</span>
          </div>
        )}
      </div>

      {/* Sub-route navigation */}
      <div className="hello-section">
        <h2 className="hello-section-title">Sub-Route Navigation</h2>
        <p className="hello-section-description">
          Navigate to the About sub-page to see plugin sub-routing in action.
        </p>
        <button className="hello-button" onClick={navigateToAbout} type="button">
          Go to About Page →
        </button>
      </div>

      {/* Deep link example */}
      <div className="hello-section">
        <h2 className="hello-section-title">Deep Link Demo</h2>
        <p className="hello-section-description">
          Copy and paste this URL to reconstruct the full UI state:
        </p>
        <code className="hello-deeplink">
          /hello?rp=hello-info&bp=hello-log
        </code>
      </div>
    </div>
  );
}
