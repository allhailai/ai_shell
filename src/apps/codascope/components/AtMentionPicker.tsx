/* ── CodaScope: AtMentionPicker ──────────────────────────────────────
   Two-stage dropdown for @-mention context injection:
   
   Stage 1 — Category picker (Wiki, Sources, Code, Designs, Definition)
   Stage 2 — Searchable list per category with debounced filtering.
   
   Performance:
   - Code Files: lazy-loaded directories on expand
   - Wiki/Sources/Designs: cached per picker session
   - All search: 300ms debounce
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  IconWiki,
  IconSearch,
  IconFile,
  IconFolder,
  IconPaintbrush,
  IconEpic,
} from "./CodaScopeIcons";

/* ── Types ───────────────────────────────────────────────────────── */

export interface AtMentionItem {
  id: string;
  label: string;
  category: AtMentionCategory;
  /** Additional metadata (e.g., topicId, sourceId) */
  metadata?: Record<string, unknown>;
}

export type AtMentionCategory =
  | "wiki"
  | "source"
  | "code"
  | "design"
  | "definition";

interface CategoryDef {
  id: AtMentionCategory;
  label: string;
  icon: React.ReactNode;
  /** Whether this category has a search/list stage */
  hasList: boolean;
}

interface AtMentionPickerProps {
  projectId: string;
  epicId: string | null;
  onSelect: (item: AtMentionItem) => void;
  onClose: () => void;
}

/* ── Constants ───────────────────────────────────────────────────── */

const CATEGORIES: CategoryDef[] = [
  { id: "wiki", label: "Wiki Pages", icon: <IconWiki size={16} />, hasList: true },
  { id: "source", label: "Research Sources", icon: <IconSearch size={16} />, hasList: true },
  { id: "design", label: "Design Documents", icon: <IconPaintbrush size={16} />, hasList: true },
  { id: "code", label: "Code Files", icon: <IconFile size={16} />, hasList: true },
  { id: "definition", label: "Epic Definition", icon: <IconEpic size={16} />, hasList: false },
];

const DEBOUNCE_MS = 300;

/* ── Component ───────────────────────────────────────────────────── */

export function AtMentionPicker({
  projectId,
  epicId,
  onSelect,
  onClose,
}: AtMentionPickerProps) {
  const [stage, setStage] = useState<"categories" | "list">("categories");
  const [activeCategory, setActiveCategory] = useState<AtMentionCategory | null>(null);
  const [items, setItems] = useState<AtMentionItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cache for category results (per picker session)
  const cacheRef = useRef<Record<string, AtMentionItem[]>>({});

  /* ── Keyboard navigation ──────────────────────────────────────── */

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (stage === "list") {
          setStage("categories");
          setActiveCategory(null);
          setFocusIndex(0);
          setSearch("");
        } else {
          onClose();
        }
        return;
      }

      const listItems = stage === "categories" ? CATEGORIES : filteredItems;
      const maxIndex = listItems.length - 1;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((prev) => Math.min(prev + 1, maxIndex));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (stage === "categories") {
          const cat = CATEGORIES[focusIndex];
          if (cat) handleCategorySelect(cat);
        } else {
          const item = filteredItems[focusIndex];
          if (item) onSelect(item);
        }
      }
    };

    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, focusIndex, items, search]);

  /* ── Click outside ─────────────────────────────────────────────── */

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid catching the @ keystroke click
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  /* ── Focus search input in list stage ──────────────────────────── */

  useEffect(() => {
    if (stage === "list" && searchRef.current) {
      searchRef.current.focus();
    }
  }, [stage]);

  /* ── Data fetching ────────────────────────────────────────────── */

  const fetchCategoryItems = useCallback(async (category: AtMentionCategory) => {
    // Check cache
    const cacheKey = `${category}-${epicId ?? "none"}`;
    if (cacheRef.current[cacheKey]) {
      setItems(cacheRef.current[cacheKey]);
      return;
    }

    setLoading(true);
    try {
      let fetchedItems: AtMentionItem[] = [];

      switch (category) {
        case "wiki": {
          const res = await fetch(`/api/codascope/projects/${projectId}/wiki`);
          if (res.ok) {
            const data = await res.json();
            fetchedItems = (data.topics ?? []).map((t: { id: string; title: string }) => ({
              id: t.id,
              label: t.title,
              category: "wiki" as const,
              metadata: { topicId: t.id },
            }));
          }
          break;
        }
        case "source": {
          if (!epicId) break;
          const res = await fetch(
            `/api/codascope/projects/${projectId}/epics/${epicId}/knowledge/sources`,
          );
          if (res.ok) {
            const data = await res.json();
            fetchedItems = (data.sources ?? []).map((s: { id: string; title: string }) => ({
              id: s.id,
              label: s.title,
              category: "source" as const,
              metadata: { sourceId: s.id },
            }));
          }
          break;
        }
        case "design": {
          if (!epicId) break;
          const res = await fetch(
            `/api/codascope/projects/${projectId}/epics/${epicId}/designs`,
          );
          if (res.ok) {
            const data = await res.json();
            fetchedItems = (data.docs ?? []).map((d: { id: string; title: string }) => ({
              id: d.id,
              label: d.title,
              category: "design" as const,
              metadata: { docId: d.id, epicId },
            }));
          }
          break;
        }
        case "code": {
          // Code files — lazy load top level. For simplicity, use repo listing.
          const repoRes = await fetch(`/api/codascope/projects/${projectId}`);
          if (repoRes.ok) {
            const data = await repoRes.json();
            const repos = data.project?.repositories ?? [];
            fetchedItems = repos.map((r: { id: string; name: string; path: string }) => ({
              id: r.id,
              label: r.name,
              category: "code" as const,
              metadata: { repoId: r.id, repoName: r.name, path: r.path, isRepo: true },
            }));
          }
          break;
        }
      }

      cacheRef.current[cacheKey] = fetchedItems;
      setItems(fetchedItems);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, epicId]);

  /* ── Category selection ────────────────────────────────────────── */

  const handleCategorySelect = useCallback((cat: CategoryDef) => {
    if (cat.id === "definition") {
      // Immediate insert — no list stage
      onSelect({
        id: "definition",
        label: "Epic Definition",
        category: "definition",
        metadata: { epicId },
      });
      return;
    }

    setActiveCategory(cat.id);
    setStage("list");
    setFocusIndex(0);
    setSearch("");
    void fetchCategoryItems(cat.id);
  }, [epicId, onSelect, fetchCategoryItems]);

  /* ── Filtered items (debounced search) ─────────────────────────── */

  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const filteredItems = useMemo(() => {
    if (!debouncedSearch.trim()) return items;
    const q = debouncedSearch.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [items, debouncedSearch]);

  // Reset focus index when filtered items change
  useEffect(() => {
    setFocusIndex(0);
  }, [filteredItems.length]);

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <div ref={containerRef} className="codascope-at-mention-picker">
      {stage === "categories" ? (
        /* Stage 1: Category Picker */
        <div className="codascope-at-mention-categories">
          <div className="codascope-at-mention-header">
            <span className="codascope-at-mention-header-label">Add context</span>
          </div>
          <div className="codascope-at-mention-list">
            {CATEGORIES.map((cat, idx) => {
              // Hide categories that need an epic but none is active
              if (!epicId && (cat.id === "source" || cat.id === "design" || cat.id === "definition")) {
                return null;
              }
              return (
                <button
                  key={cat.id}
                  className={`codascope-at-mention-item ${idx === focusIndex ? "codascope-at-mention-item--focused" : ""}`}
                  onClick={() => handleCategorySelect(cat)}
                  onMouseEnter={() => setFocusIndex(idx)}
                  type="button"
                >
                  <span className="codascope-at-mention-item-icon">{cat.icon}</span>
                  <span className="codascope-at-mention-item-label">{cat.label}</span>
                  {cat.hasList && (
                    <span className="codascope-at-mention-item-arrow">›</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* Stage 2: Searchable List */
        <div className="codascope-at-mention-search-list">
          <div className="codascope-at-mention-header">
            <button
              className="codascope-at-mention-back"
              onClick={() => {
                setStage("categories");
                setActiveCategory(null);
                setFocusIndex(0);
                setSearch("");
              }}
              type="button"
              title="Back to categories"
            >
              ‹
            </button>
            <span className="codascope-at-mention-header-label">
              {CATEGORIES.find((c) => c.id === activeCategory)?.label ?? "Items"}
            </span>
          </div>
          <div className="codascope-at-mention-search">
            <input
              ref={searchRef}
              className="codascope-at-mention-search-input"
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                // Prevent @ trigger from parent
                e.stopPropagation();
              }}
            />
          </div>
          <div className="codascope-at-mention-list">
            {loading ? (
              <div className="codascope-at-mention-loading">Loading...</div>
            ) : filteredItems.length === 0 ? (
              <div className="codascope-at-mention-empty">
                {items.length === 0 ? "No items available" : "No matches"}
              </div>
            ) : (
              filteredItems.map((item, idx) => (
                <button
                  key={item.id}
                  className={`codascope-at-mention-item ${idx === focusIndex ? "codascope-at-mention-item--focused" : ""}`}
                  onClick={() => onSelect(item)}
                  onMouseEnter={() => setFocusIndex(idx)}
                  type="button"
                >
                  <span className="codascope-at-mention-item-icon">
                    {activeCategory === "wiki" && <IconWiki size={14} />}
                    {activeCategory === "source" && <IconSearch size={14} />}
                    {activeCategory === "design" && <IconPaintbrush size={14} />}
                    {activeCategory === "code" && (
                      item.metadata?.isRepo ? <IconFolder size={14} /> : <IconFile size={14} />
                    )}
                  </span>
                  <span className="codascope-at-mention-item-label">{item.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
