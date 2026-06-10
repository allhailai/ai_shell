import { useEffect, useState } from "react";
import { useCommandBus } from "../../shell/hooks";

interface ActivityEntry {
  id: number;
  timestamp: string;
  type: string;
  detail: string;
}

let nextId = 1;

/**
 * Bottom panel — live activity log.
 * Subscribes to Command Bus events to show a real-time event stream.
 */
export function HelloLogPanel(_props: { params?: Record<string, string> }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const bus = useCommandBus();

  useEffect(() => {
    // Subscribe to hello.activity events
    const unsub = bus.on("hello.activity", (payload) => {
      const data = payload as { type: string; name?: string; result?: string };
      setEntries((prev) => [
        {
          id: nextId++,
          timestamp: new Date().toLocaleTimeString(),
          type: data.type,
          detail: data.result ?? JSON.stringify(data),
        },
        ...prev,
      ].slice(0, 50)); // Keep last 50 entries
    });

    // Add an initial entry
    setEntries([{
      id: nextId++,
      timestamp: new Date().toLocaleTimeString(),
      type: "system",
      detail: "Activity log initialized. Try invoking commands from the main page.",
    }]);

    return unsub;
  }, [bus]);

  return (
    <div className="hello-log-panel">
      <div className="hello-log-entries">
        {entries.map((entry) => (
          <div key={entry.id} className="hello-log-entry">
            <span className="hello-log-time">{entry.timestamp}</span>
            <span className={`hello-log-type hello-log-type-${entry.type}`}>
              {entry.type}
            </span>
            <span className="hello-log-detail">{entry.detail}</span>
          </div>
        ))}
      </div>
      {entries.length === 0 && (
        <p className="hello-log-empty">No activity yet.</p>
      )}
    </div>
  );
}
