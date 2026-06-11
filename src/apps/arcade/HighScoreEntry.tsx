import { useState, useRef, useEffect, useCallback } from "react";

/**
 * High score initials entry modal.
 * Shows when game ends with a qualifying score.
 * 3-character uppercase input, defaults to "XXX".
 * Auto-submits after 10 seconds if user doesn't interact.
 */
export function HighScoreEntry({
  score,
  rank,
  onSubmit,
}: {
  score: number;
  rank: number;
  onSubmit: (initials: string) => void;
}) {
  const [initials, setInitials] = useState("XXX");
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Auto-submit after 10 seconds
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onSubmit(initials || "XXX");
    }, 10000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus the input
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    setInitials(val);
    // Reset auto-submit timer on interaction
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onSubmit(val || "XXX");
    }, 10000);
  }, [onSubmit]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (timerRef.current) clearTimeout(timerRef.current);
      onSubmit(initials || "XXX");
    },
    [initials, onSubmit],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (timerRef.current) clearTimeout(timerRef.current);
        onSubmit("XXX");
      }
    },
    [onSubmit],
  );

  return (
    <div className="hs-entry-overlay" onKeyDown={handleKeyDown}>
      <div className="hs-entry-modal">
        <div className="hs-entry-badge">🏆</div>
        <h2 className="hs-entry-title">New High Score!</h2>
        <p className="hs-entry-rank">Rank #{rank}</p>
        <p className="hs-entry-score">{score.toLocaleString()}</p>

        <form className="hs-entry-form" onSubmit={handleSubmit}>
          <label className="hs-entry-label" htmlFor="hs-initials">
            Enter your initials
          </label>
          <input
            ref={inputRef}
            id="hs-initials"
            className="hs-entry-input"
            type="text"
            value={initials}
            onChange={handleChange}
            maxLength={3}
            placeholder="XXX"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="hs-entry-submit" type="submit">
            Submit
          </button>
        </form>

        <p className="hs-entry-hint">Press Enter to submit, Escape to skip</p>
      </div>
    </div>
  );
}
