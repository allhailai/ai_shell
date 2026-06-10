import type { PluginManifest } from "../types/plugin";
import { useShellStore } from "../shell/store";
import { useCallback, useMemo, type ReactNode } from "react";

/**
 * Left navigation panel.
 * Renders plugin pages as nav items, grouped or flat based on manifest.
 */
export function LeftNav({ plugins }: { plugins: PluginManifest[] }) {
  const activePluginId = useShellStore((s) => s.activePluginId);
  const collapsed = useShellStore((s) => s.leftNavCollapsed);

  // Group plugins: ungrouped first, then grouped
  const { ungrouped, groups } = useMemo(() => {
    const ungrouped: PluginManifest[] = [];
    const groupMap = new Map<string, PluginManifest[]>();

    for (const plugin of plugins) {
      if (plugin.group) {
        const list = groupMap.get(plugin.group) ?? [];
        list.push(plugin);
        groupMap.set(plugin.group, list);
      } else {
        ungrouped.push(plugin);
      }
    }

    // Sort within groups by order
    const groups = [...groupMap.entries()].map(([name, items]) => ({
      name,
      items: items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }));

    return { ungrouped: ungrouped.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), groups };
  }, [plugins]);

  return (
    <nav className="left-nav" aria-label="Module navigation">
      <div className="left-nav-content scrollable-y">
        {/* Ungrouped items */}
        {ungrouped.map((plugin) => (
          <NavItem
            key={plugin.id}
            plugin={plugin}
            active={activePluginId === plugin.id}
            collapsed={collapsed}
          />
        ))}

        {/* Grouped items */}
        {groups.map((group) => (
          <NavGroup key={group.name} name={group.name} collapsed={collapsed}>
            {group.items.map((plugin) => (
              <NavItem
                key={plugin.id}
                plugin={plugin}
                active={activePluginId === plugin.id}
                collapsed={collapsed}
              />
            ))}
          </NavGroup>
        ))}
      </div>
    </nav>
  );
}

function NavGroup({
  name,
  collapsed,
  children,
}: {
  name: string;
  collapsed: boolean;
  children: ReactNode;
}) {
  if (collapsed) {
    // In collapsed mode, don't show group labels — just render children
    return <>{children}</>;
  }

  return (
    <div className="nav-group">
      <div className="nav-group-label">
        <span>{name}</span>
      </div>
      <div className="nav-group-items">{children}</div>
    </div>
  );
}

function NavItem({
  plugin,
  active,
  collapsed,
}: {
  plugin: PluginManifest;
  active: boolean;
  collapsed: boolean;
}) {
  const setActivePlugin = useShellStore((s) => s.setActivePlugin);

  const handleClick = useCallback(() => {
    setActivePlugin(plugin.id);
  }, [plugin.id, setActivePlugin]);

  const Icon = plugin.icon;

  return (
    <button
      className={`nav-item${active ? " active" : ""}`}
      onClick={handleClick}
      title={collapsed ? plugin.name : undefined}
      aria-current={active ? "page" : undefined}
      type="button"
    >
      <span className="nav-item-icon">
        {Icon ? (
          <Icon size={18} />
        ) : (
          <DefaultPluginIcon />
        )}
      </span>
      <span className="nav-item-label">{plugin.name}</span>
    </button>
  );
}

function DefaultPluginIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 12h6M12 9v6" />
    </svg>
  );
}
