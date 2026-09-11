import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Layers,
  LogOut,
  Search,
  Sparkles,
} from "lucide-react";
import { MODULES, type Module, type ModuleMeta } from "../modules";
import {
  listProcessCases,
  type Company,
  type HealthResponse,
  type ProcessCase,
  type UserReadResponse,
} from "../api";

type Props = {
  activeModule: Module;
  onModuleChange: (m: Module) => void;
  company: Company | null;
  health: HealthResponse | null;
  user: UserReadResponse | null;
  onLogout: () => void;
  children: ReactNode;
  aiDock?: ReactNode;
  onOpenCase?: (caseId: string) => void;
};

export function AppShell({
  activeModule,
  onModuleChange,
  company,
  health,
  user,
  onLogout,
  children,
  aiDock,
  onOpenCase,
}: Props) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiDockOpen, setAiDockOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const userRole = user?.role ?? "viewer";
  const isAdmin = userRole === "admin";

  const visibleModules = MODULES.filter((m) => {
    if (m.requiresRole === "admin" && !isAdmin) return false;
    return true;
  });

  // ── Cmd+K palette ────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`shell ${sidebarCollapsed ? "shell--collapsed" : ""} ${aiDockOpen ? "shell--ai-open" : ""}`}>
      <TopBar
        company={company}
        user={user}
        userMenuOpen={userMenuOpen}
        onToggleUserMenu={() => setUserMenuOpen((v) => !v)}
        onLogout={onLogout}
        aiDockOpen={aiDockOpen}
        onToggleAiDock={() => setAiDockOpen((v) => !v)}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <Sidebar
        collapsed={sidebarCollapsed}
        activeModule={activeModule}
        modules={visibleModules}
        onModuleChange={onModuleChange}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        health={health}
      />

      <main className="shell-main">
        {children}
      </main>

      {aiDock && aiDockOpen && (
        <aside className="shell-ai-dock">
          {aiDock}
        </aside>
      )}

      {paletteOpen && (
        <CommandPalette
          modules={visibleModules}
          onSelectModule={(m) => { onModuleChange(m); setPaletteOpen(false); }}
          onSelectCase={(caseId) => {
            if (onOpenCase) onOpenCase(caseId);
            else onModuleChange("procesos");
            setPaletteOpen(false);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

// ── TopBar ──────────────────────────────────────────────────────────────────

type TopBarProps = {
  company: Company | null;
  user: UserReadResponse | null;
  userMenuOpen: boolean;
  onToggleUserMenu: () => void;
  onLogout: () => void;
  aiDockOpen: boolean;
  onToggleAiDock: () => void;
  onOpenPalette: () => void;
};

function TopBar({
  company,
  user,
  userMenuOpen,
  onToggleUserMenu,
  onLogout,
  aiDockOpen,
  onToggleAiDock,
  onOpenPalette,
}: TopBarProps) {
  const initials = (user?.full_name ?? user?.username ?? "U")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <header className="shell-topbar">
      <div className="shell-topbar-brand">
        <div className="brand-mark" style={{ margin: 0, width: 32, height: 32, fontSize: "0.85rem" }}>BP</div>
        <div className="shell-topbar-titles">
          <strong>BPMS Cognitive</strong>
          {company && <span className="shell-topbar-company">{company.nombre_corto ?? company.razon_social}</span>}
        </div>
      </div>

      <button
        type="button"
        className="shell-topbar-search shell-topbar-search-btn"
        onClick={onOpenPalette}
      >
        <Search size={14} />
        <span style={{ flex: 1, textAlign: "left" }}>Buscar procesos, módulos…</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="shell-topbar-actions">
        <button
          type="button"
          className={`shell-topbar-iconbtn shell-topbar-ai ${aiDockOpen ? "active" : ""}`}
          title="AI Workspace"
          onClick={onToggleAiDock}
        >
          <Sparkles size={16} />
          <span className="shell-topbar-ai-label">IA</span>
        </button>

        <div className="shell-topbar-user">
          <button type="button" className="shell-topbar-userbtn" onClick={onToggleUserMenu}>
            <span className="shell-topbar-avatar">{initials || "U"}</span>
            <div className="shell-topbar-userinfo">
              <strong>{user?.full_name ?? user?.username ?? "Usuario"}</strong>
              <span>{user?.role ?? ""}</span>
            </div>
          </button>

          {userMenuOpen && (
            <div className="shell-topbar-usermenu" onMouseLeave={onToggleUserMenu}>
              <div className="shell-topbar-usermenu-header">
                <strong>{user?.full_name ?? user?.username}</strong>
                <span>{user?.email ?? ""}</span>
              </div>
              <button type="button" className="shell-topbar-usermenu-item" onClick={onLogout}>
                <LogOut size={13} /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ── Sidebar ─────────────────────────────────────────────────────────────────

type SidebarProps = {
  collapsed: boolean;
  activeModule: Module;
  modules: ModuleMeta[];
  onModuleChange: (m: Module) => void;
  onToggleCollapse: () => void;
  health: HealthResponse | null;
};

function Sidebar({
  collapsed,
  activeModule,
  modules,
  onModuleChange,
  onToggleCollapse,
  health,
}: SidebarProps) {
  return (
    <nav className="shell-sidebar">
      <div className="shell-sidebar-modules">
        {modules.map((m) => {
          const Icon = m.icon;
          const isActive = m.id === activeModule;
          return (
            <button
              key={m.id}
              type="button"
              className={`shell-sidebar-item ${isActive ? "active" : ""}`}
              onClick={() => onModuleChange(m.id)}
              title={collapsed ? m.label : undefined}
              style={isActive ? { borderLeftColor: m.accent } : undefined}
            >
              <Icon size={17} style={isActive ? { color: m.accent } : undefined} />
              {!collapsed && (
                <span className="shell-sidebar-label">
                  {m.label}
                  {m.comingSoon && (
                    <span className="shell-sidebar-soon">próx.</span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="shell-sidebar-footer">
        <div className={`status-pill compact ${health?.status === "ok" ? "online" : "offline"}`}>
          <Activity size={12} />
          {!collapsed && <span>{health?.status === "ok" ? "API conectada" : "Sin conexión"}</span>}
        </div>

        <button
          type="button"
          className="shell-sidebar-collapse"
          onClick={onToggleCollapse}
          title={collapsed ? "Expandir menú" : "Colapsar menú"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          {!collapsed && <span>Colapsar</span>}
        </button>
      </div>
    </nav>
  );
}

// ── Command Palette (Cmd+K) ─────────────────────────────────────────────────

type CommandPaletteProps = {
  modules: ModuleMeta[];
  onSelectModule: (m: Module) => void;
  onSelectCase: (caseId: string) => void;
  onClose: () => void;
};

function CommandPalette({
  modules,
  onSelectModule,
  onSelectCase,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [cases, setCases] = useState<ProcessCase[]>([]);

  useEffect(() => {
    void listProcessCases().then(setCases).catch(() => setCases([]));
  }, []);

  const q = query.toLowerCase().trim();
  const filteredModules = q
    ? modules.filter((m) =>
        m.label.toLowerCase().includes(q) || m.description.toLowerCase().includes(q),
      )
    : modules;
  const filteredCases = q
    ? cases.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 10)
    : cases.slice(0, 5);

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-input">
          <Search size={16} style={{ color: "var(--muted)" }} />
          <input
            type="text"
            autoFocus
            placeholder="Buscar módulos, procesos…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>ESC</kbd>
        </div>

        <div className="command-palette-results">
          {filteredModules.length > 0 && (
            <section>
              <div className="command-palette-section-label">Módulos</div>
              {filteredModules.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="command-palette-item"
                    onClick={() => onSelectModule(m.id)}
                  >
                    <Icon size={15} style={{ color: m.accent }} />
                    <div>
                      <strong>{m.label}</strong>
                      <span className="muted">{m.description}</span>
                    </div>
                  </button>
                );
              })}
            </section>
          )}

          {filteredCases.length > 0 && (
            <section>
              <div className="command-palette-section-label">Procesos</div>
              {filteredCases.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="command-palette-item"
                  onClick={() => onSelectCase(c.id)}
                >
                  <Layers size={15} style={{ color: "var(--teal)" }} />
                  <div>
                    <strong>{c.name}</strong>
                    <span className="muted">
                      N{c.level ?? "?"} · {c.process_type ?? "—"} · {c.area ?? "Sin área"}
                    </span>
                  </div>
                </button>
              ))}
            </section>
          )}

          {filteredModules.length === 0 && filteredCases.length === 0 && (
            <p className="muted" style={{ textAlign: "center", padding: 20 }}>
              Sin resultados para "{query}"
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
