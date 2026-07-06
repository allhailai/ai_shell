/* ── CodaScope: Slash Command Palette ────────────────────────────────
   Floating palette anchored above the chat input.
   Triggered when user types `/` as the first char on empty input.

   Features:
   - Fuzzy-filter as user types
   - ↑ ↓ keyboard navigation
   - Enter to select, Escape to dismiss
   - Relevant commands grouped at top, others dimmed below
   - Smooth fade-in animation
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useCallback, useMemo } from "react";
import {
  getFilteredCommands,
  type SlashCommand,
  type CommandContext,
  type CommandCategory,
} from "../commandRegistry";
import {
  IconCodeMap,
  IconSearch,
  IconArrowRight,
  IconEpic,
  IconPaintbrush,
  IconKnowledge,
  IconHelp,
} from "./CodaScopeIcons";

// ── Category Icons ──────────────────────────────────────────────────

function CategoryIcon({ category }: { category: CommandCategory }) {
  switch (category) {
    case "build":
      return <IconCodeMap size={14} />;
    case "analyze":
      return <IconSearch size={14} />;
    case "navigate":
      return <IconArrowRight size={14} />;
    case "epic":
      return <IconEpic size={14} />;
    case "design":
      return <IconPaintbrush size={14} />;
    case "knowledge":
      return <IconKnowledge size={14} />;
    case "help":
      return <IconHelp size={14} />;
    default:
      return <IconHelp size={14} />;
  }
}

// ── Props ───────────────────────────────────────────────────────────

interface SlashCommandPaletteProps {
  isOpen: boolean;
  query: string;
  context: CommandContext;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  /** Active index managed by parent for keyboard nav */
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}

// ── Component ───────────────────────────────────────────────────────

export function SlashCommandPalette({
  isOpen,
  query,
  context,
  onSelect,
  onClose,
  activeIndex,
  onActiveIndexChange,
}: SlashCommandPaletteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // Filter and group commands
  const { relevant, other } = useMemo(
    () => getFilteredCommands(query, context),
    [query, context],
  );

  // Flat list for keyboard navigation
  const allItems = useMemo(
    () => [...relevant, ...other],
    [relevant, other],
  );

  // Scroll active item into view
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  const handleItemClick = useCallback(
    (cmd: SlashCommand) => {
      onSelect(cmd);
    },
    [onSelect],
  );

  if (!isOpen) return null;

  const showDivider = relevant.length > 0 && other.length > 0;

  return (
    <div ref={containerRef} className="codascope-slash-palette">
      {/* Filter display */}
      <div className="codascope-slash-palette-header">
        <span className="codascope-slash-palette-filter-icon">/</span>
        <span className="codascope-slash-palette-filter-text">
          {query || "Type to filter commands…"}
        </span>
      </div>

      {/* Command list */}
      <div className="codascope-slash-palette-list">
        {allItems.length === 0 ? (
          <div className="codascope-slash-palette-empty">
            No matching commands
          </div>
        ) : (
          <>
            {/* Relevant commands */}
            {relevant.map((cmd) => {
              const flatIdx = allItems.indexOf(cmd);
              return (
                <button
                  key={cmd.id}
                  ref={flatIdx === activeIndex ? activeItemRef : undefined}
                  className={`codascope-slash-palette-item${flatIdx === activeIndex ? " codascope-slash-palette-item--active" : ""}`}
                  onClick={() => handleItemClick(cmd)}
                  onMouseEnter={() => onActiveIndexChange(flatIdx)}
                  type="button"
                >
                  <span className="codascope-slash-palette-category-icon">
                    <CategoryIcon category={cmd.category} />
                  </span>
                  <span className="codascope-slash-palette-slash">{cmd.slash}</span>
                  <span className="codascope-slash-palette-label">{cmd.label}</span>
                </button>
              );
            })}

            {/* Divider */}
            {showDivider && (
              <div className="codascope-slash-palette-divider">
                <span>More commands</span>
              </div>
            )}

            {/* Other commands (dimmed) */}
            {other.map((cmd) => {
              const flatIdx = allItems.indexOf(cmd);
              return (
                <button
                  key={cmd.id}
                  ref={flatIdx === activeIndex ? activeItemRef : undefined}
                  className={`codascope-slash-palette-item codascope-slash-palette-item--dimmed${flatIdx === activeIndex ? " codascope-slash-palette-item--active" : ""}`}
                  onClick={() => handleItemClick(cmd)}
                  onMouseEnter={() => onActiveIndexChange(flatIdx)}
                  type="button"
                >
                  <span className="codascope-slash-palette-category-icon">
                    <CategoryIcon category={cmd.category} />
                  </span>
                  <span className="codascope-slash-palette-slash">{cmd.slash}</span>
                  <span className="codascope-slash-palette-label">{cmd.label}</span>
                </button>
              );
            })}
          </>
        )}
      </div>

      {/* Footer hint */}
      <div className="codascope-slash-palette-footer">
        <kbd>↑↓</kbd> navigate
        <kbd>↵</kbd> select
        <kbd>esc</kbd> close
      </div>
    </div>
  );
}

/**
 * Returns the total number of items currently visible in the palette.
 * Used by the parent to clamp keyboard navigation.
 */
export function getVisibleCommandCount(query: string, context: CommandContext): number {
  const { relevant, other } = getFilteredCommands(query, context);
  return relevant.length + other.length;
}
