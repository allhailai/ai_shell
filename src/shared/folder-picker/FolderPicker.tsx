/* ── Shared: FolderPicker ──────────────────────────────────────────────
   A reusable folder/file browser modal built on the native <dialog>.
   
   Features:
   - Breadcrumb navigation with clickable path segments
   - Quick-access roots (Home, /opt, Desktop, etc.)
   - Directory listing with expand-to-navigate
   - Real-time search/filter within current directory
   - Manual path input with validation
   - Configurable: folder-only or file+folder mode
   - Keyboard: Escape to close, Enter to select, arrow keys for nav
   
   Usage:
     <FolderPicker
       open={showPicker}
       onClose={() => setShowPicker(false)}
       onSelect={(path) => handlePathSelected(path)}
       mode="directory"           // "directory" | "file" | "both"
       title="Select Repository"  // optional title
       initialPath="/opt"         // optional starting path
     />
   ──────────────────────────────────────────────────────────────────── */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type KeyboardEvent,
} from "react";

// ── Types ───────────────────────────────────────────────────────────

export interface FolderPickerEntry {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink";
  size?: number;
  hidden: boolean;
  readable: boolean;
}

export interface FolderPickerRoot {
  label: string;
  path: string;
  icon: string;
}

export type FolderPickerMode = "directory" | "file" | "both";

export interface FolderPickerProps {
  /** Whether the picker dialog is open. */
  open: boolean;
  /** Called when the dialog is closed (cancel or backdrop click). */
  onClose: () => void;
  /** Called with the selected absolute path. */
  onSelect: (path: string) => void;
  /** What can be selected: directories, files, or both. Default: "directory" */
  mode?: FolderPickerMode;
  /** Dialog title. Default: "Select Folder" */
  title?: string;
  /** Initial path to browse. Default: home directory. */
  initialPath?: string;
  /** Placeholder for the manual path input. */
  placeholder?: string;
}

// ── Component ───────────────────────────────────────────────────────

export function FolderPicker({
  open,
  onClose,
  onSelect,
  mode = "directory",
  title,
  initialPath,
  placeholder,
}: FolderPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);

  // ── State ─────────────────────────────────────────────────────────
  const [currentPath, setCurrentPath] = useState(initialPath ?? "");
  const [entries, setEntries] = useState<FolderPickerEntry[]>([]);
  const [roots, setRoots] = useState<FolderPickerRoot[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [manualPath, setManualPath] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  // ── Dialog open/close ─────────────────────────────────────────────
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Handle native dialog close (Escape key, backdrop click)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  // Handle backdrop click (light dismiss)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClick = (e: MouseEvent) => {
      const rect = dialog.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        dialog.close();
      }
    };
    dialog.addEventListener("click", handleClick);
    return () => dialog.removeEventListener("click", handleClick);
  }, []);

  // ── Fetch roots on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const res = await fetch("/api/filesystem/roots");
        if (res.ok) {
          const data = await res.json();
          setRoots(data.roots ?? []);
        }
      } catch {
        // Silently fail — roots are optional
      }
    })();
  }, [open]);

  // ── Fetch directory contents ──────────────────────────────────────
  const browse = useCallback(
    async (path: string) => {
      setLoading(true);
      setError("");
      setSearch("");
      setFocusedIndex(-1);

      try {
        const showFiles = mode !== "directory";
        const params = new URLSearchParams({
          path,
          showFiles: String(showFiles),
          showHidden: String(showHidden),
        });
        const res = await fetch(`/api/filesystem/browse?${params}`);
        if (res.ok) {
          const data = await res.json();
          setCurrentPath(data.path);
          setParentPath(data.parent);
          setEntries(data.entries ?? []);
          setManualPath(data.path);
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Failed to browse directory.");
        }
      } catch {
        setError("Network error. Is the server running?");
      } finally {
        setLoading(false);
      }
    },
    [mode, showHidden],
  );

  // Browse initial path when opened
  useEffect(() => {
    if (open) {
      browse(initialPath ?? "");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-browse when showHidden changes
  useEffect(() => {
    if (open && currentPath) {
      browse(currentPath);
    }
  }, [showHidden]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtered entries ──────────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    if (!search) return entries;
    const lower = search.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(lower));
  }, [entries, search]);

  // ── Handlers ──────────────────────────────────────────────────────

  const handleEntryClick = useCallback(
    (entry: FolderPickerEntry) => {
      if (entry.type === "directory" && entry.readable) {
        browse(entry.path);
      }
    },
    [browse],
  );

  const handleEntryDoubleClick = useCallback(
    (entry: FolderPickerEntry) => {
      if (entry.type === "directory") {
        if (mode === "directory" || mode === "both") {
          onSelect(entry.path);
          onClose();
        }
      } else {
        if (mode === "file" || mode === "both") {
          onSelect(entry.path);
          onClose();
        }
      }
    },
    [mode, onSelect, onClose],
  );

  const handleSelectCurrent = useCallback(() => {
    if (mode === "directory" || mode === "both") {
      onSelect(currentPath);
      onClose();
    }
  }, [mode, currentPath, onSelect, onClose]);

  const handleGoUp = useCallback(() => {
    if (parentPath) browse(parentPath);
  }, [parentPath, browse]);

  const handleManualNavigate = useCallback(() => {
    const trimmed = manualPath.trim();
    if (trimmed) browse(trimmed);
  }, [manualPath, browse]);

  const handleBreadcrumbClick = useCallback(
    (path: string) => {
      browse(path);
    },
    [browse],
  );

  // ── Keyboard navigation ───────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const count = filteredEntries.length;
      if (count === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((i) => Math.min(i + 1, count - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < count) {
            const entry = filteredEntries[focusedIndex];
            if (entry.type === "directory" && entry.readable) {
              browse(entry.path);
            } else if (entry.type === "file" && (mode === "file" || mode === "both")) {
              onSelect(entry.path);
              onClose();
            }
          }
          break;
        case "Backspace":
          if (!search && parentPath) {
            e.preventDefault();
            browse(parentPath);
          }
          break;
      }
    },
    [filteredEntries, focusedIndex, search, parentPath, browse, mode, onSelect, onClose],
  );

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex < 0) return;
    const el = listRef.current?.querySelector(`[data-index="${focusedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex]);

  // ── Breadcrumb segments ───────────────────────────────────────────
  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    const segments = currentPath.split("/").filter(Boolean);
    const crumbs: Array<{ label: string; path: string }> = [
      { label: "/", path: "/" },
    ];
    let accumulated = "";
    for (const seg of segments) {
      accumulated += `/${seg}`;
      crumbs.push({ label: seg, path: accumulated });
    }
    return crumbs;
  }, [currentPath]);

  // ── Format file size ──────────────────────────────────────────────
  const formatSize = useCallback((bytes?: number) => {
    if (bytes === undefined) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }, []);

  // ── Compute default title ─────────────────────────────────────────
  const dialogTitle =
    title ?? (mode === "file" ? "Select File" : mode === "both" ? "Select File or Folder" : "Select Folder");

  // ── Render ────────────────────────────────────────────────────────
  return (
    <dialog
      ref={dialogRef}
      className="fp-dialog"
      id="folder-picker-dialog"
    >
      <div className="fp-container">
        {/* Header */}
        <div className="fp-header">
          <div className="fp-header-title">{dialogTitle}</div>
          <button
            className="fp-header-close"
            onClick={onClose}
            type="button"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Quick roots */}
        <div className="fp-roots">
          {roots.map((root) => (
            <button
              key={root.path}
              className={`fp-root-btn ${currentPath === root.path ? "fp-root-btn--active" : ""}`}
              onClick={() => browse(root.path)}
              title={root.path}
              type="button"
            >
              <span className="fp-root-icon">{root.icon}</span>
              <span className="fp-root-label">{root.label}</span>
            </button>
          ))}
        </div>

        {/* Breadcrumb + search bar */}
        <div className="fp-toolbar">
          <button
            className="fp-nav-btn"
            onClick={handleGoUp}
            disabled={!parentPath}
            title="Go up one level"
            type="button"
            aria-label="Go up"
          >
            ↑
          </button>

          <div className="fp-breadcrumbs">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path} className="fp-breadcrumb-segment">
                {i > 0 && <span className="fp-breadcrumb-sep">/</span>}
                <button
                  className={`fp-breadcrumb-btn ${i === breadcrumbs.length - 1 ? "fp-breadcrumb-btn--current" : ""}`}
                  onClick={() => handleBreadcrumbClick(crumb.path)}
                  type="button"
                >
                  {crumb.label === "/" ? "⌂" : crumb.label}
                </button>
              </span>
            ))}
          </div>

          <button
            className={`fp-nav-btn ${showManualInput ? "fp-nav-btn--active" : ""}`}
            onClick={() => {
              setShowManualInput(!showManualInput);
              if (!showManualInput) {
                setTimeout(() => pathInputRef.current?.focus(), 50);
              }
            }}
            title="Type a path directly"
            type="button"
            aria-label="Toggle path input"
          >
            ✏️
          </button>
        </div>

        {/* Manual path input */}
        {showManualInput && (
          <div className="fp-manual-input">
            <input
              ref={pathInputRef}
              className="fp-path-input"
              type="text"
              placeholder={placeholder ?? "Type an absolute path…"}
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleManualNavigate();
                if (e.key === "Escape") setShowManualInput(false);
              }}
            />
            <button
              className="fp-go-btn"
              onClick={handleManualNavigate}
              type="button"
            >
              Go
            </button>
          </div>
        )}

        {/* Search filter */}
        <div className="fp-search-bar">
          <input
            className="fp-search-input"
            type="text"
            placeholder="Filter entries…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setFocusedIndex(-1);
            }}
          />
          <label className="fp-hidden-toggle">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            <span>Show hidden</span>
          </label>
        </div>

        {/* Directory listing */}
        <div
          className="fp-listing"
          ref={listRef}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="listbox"
          aria-label="Directory contents"
        >
          {loading ? (
            <div className="fp-listing-message">Loading…</div>
          ) : error ? (
            <div className="fp-listing-error">{error}</div>
          ) : filteredEntries.length === 0 ? (
            <div className="fp-listing-message">
              {search ? "No matching entries" : "Empty directory"}
            </div>
          ) : (
            filteredEntries.map((entry, index) => {
              const isDir = entry.type === "directory";
              const isFocused = index === focusedIndex;
              const canSelect =
                (isDir && (mode === "directory" || mode === "both")) ||
                (!isDir && (mode === "file" || mode === "both"));

              return (
                <div
                  key={entry.path}
                  className={[
                    "fp-entry",
                    isDir ? "fp-entry--dir" : "fp-entry--file",
                    isFocused ? "fp-entry--focused" : "",
                    !entry.readable ? "fp-entry--disabled" : "",
                    entry.hidden ? "fp-entry--hidden" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-index={index}
                  onClick={() => handleEntryClick(entry)}
                  onDoubleClick={() => handleEntryDoubleClick(entry)}
                  onMouseEnter={() => setFocusedIndex(index)}
                  role="option"
                  aria-selected={isFocused}
                  title={entry.readable ? entry.path : `${entry.path} (not accessible)`}
                >
                  <span className="fp-entry-icon">
                    {isDir
                      ? entry.readable
                        ? "📁"
                        : "🔒"
                      : "📄"}
                  </span>
                  <span className="fp-entry-name">{entry.name}</span>
                  {!isDir && entry.size !== undefined && (
                    <span className="fp-entry-size">{formatSize(entry.size)}</span>
                  )}
                  {canSelect && entry.readable && (
                    <button
                      className="fp-entry-select-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(entry.path);
                        onClose();
                      }}
                      title={`Select ${entry.name}`}
                      type="button"
                    >
                      Select
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="fp-footer">
          <div className="fp-footer-path" title={currentPath}>
            {currentPath}
          </div>
          <div className="fp-footer-actions">
            <button
              className="fp-btn fp-btn--ghost"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            {(mode === "directory" || mode === "both") && (
              <button
                className="fp-btn fp-btn--primary"
                onClick={handleSelectCurrent}
                type="button"
              >
                Select This Folder
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
