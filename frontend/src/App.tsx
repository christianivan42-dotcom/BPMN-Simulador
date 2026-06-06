import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { ModuleExpertDock } from "./components/ModuleExpertDock";
import { HomeModule } from "./components/modules/HomeModule";
import { ProcesosModule, type ProcesosStep } from "./components/modules/ProcesosModule";
import { ConocimientoModule } from "./components/modules/ConocimientoModule";
import {
  getFirstCompany,
  createCompany,
  getHealth,
  type Company,
  type HealthResponse,
  type UserReadResponse,
} from "./api";
import type { Module } from "./modules";

type AppState = "loading" | "error" | "app";

// Acceso libre — sin login. Usuario "invitado" por defecto.
const GUEST_USER: UserReadResponse = {
  id: "guest",
  username: "invitado",
  email: "",
  full_name: "Invitado",
  role: "admin",
  is_active: true,
  created_at: new Date().toISOString(),
};

// ── Module persistence ───────────────────────────────────────────────────────
const MODULE_KEY = "bpms_active_module";
const PROCESOS_STEP_KEY = "bpms_procesos_step";

function loadActiveModule(): Module {
  try {
    const raw = localStorage.getItem(MODULE_KEY);
    if (raw) return raw as Module;
  } catch { /* ignore */ }
  return "procesos";
}

function saveActiveModule(m: Module) {
  try { localStorage.setItem(MODULE_KEY, m); } catch { /* ignore */ }
}

function loadProcesosStep(): ProcesosStep {
  try {
    return (localStorage.getItem(PROCESOS_STEP_KEY) ?? "mapa") as ProcesosStep;
  } catch {
    return "mapa";
  }
}

function saveProcesosStep(step: ProcesosStep) {
  try { localStorage.setItem(PROCESOS_STEP_KEY, step); } catch { /* ignore */ }
}

export function App() {
  const [appState, setAppState] = useState<AppState>("loading");
  const [company, setCompany] = useState<Company | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [activeModule, setActiveModule] = useState<Module>(() => loadActiveModule());

  const initialProcesosStep = loadProcesosStep();

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap() {
    setAppState("loading");
    try {
      const [existing, h] = await Promise.all([getFirstCompany(), getHealth().catch(() => null)]);
      setHealth(h);
      // No company yet → create a minimal default silently (no setup prompt).
      const c = existing ?? (await createCompany({ razon_social: "Mi organización" }));
      setCompany(c);
      setAppState("app");
    } catch {
      setAppState("error");
    }
  }

  function handleModuleChange(m: Module) {
    setActiveModule(m);
    saveActiveModule(m);
  }

  function handleCompanyUpdated(c: Company) {
    setCompany(c);
  }

  function openCaseFromHome(_caseId: string) {
    handleModuleChange("procesos");
  }

  // ── Render flow ────────────────────────────────────────────────────────────

  if (appState === "loading" || appState === "error") {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div style={{ textAlign: "center", color: "var(--muted)" }}>
          <div className="brand-mark" style={{ margin: "0 auto 16px" }}>BP</div>
          {appState === "loading" ? (
            <p>Iniciando BPMS Cognitive…</p>
          ) : (
            <>
              <p>No se pudo conectar con el backend.</p>
              <button type="button" className="btn-primary" style={{ marginTop: 12 }} onClick={() => void bootstrap()}>
                Reintentar
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <AppShell
      activeModule={activeModule}
      onModuleChange={handleModuleChange}
      company={company}
      health={health}
      user={GUEST_USER}
      onLogout={() => window.location.reload()}
      onOpenCase={openCaseFromHome}
      aiDock={<ModuleExpertDock activeModule={activeModule} />}
    >
      {activeModule === "inicio" && company && (
        <HomeModule company={company} onCompanyUpdated={handleCompanyUpdated} />
      )}

      {activeModule === "procesos" && company && (
        <ProcesosModule
          company={company}
          onCompanyUpdated={handleCompanyUpdated}
          initialStep={initialProcesosStep}
          onStepChange={saveProcesosStep}
        />
      )}

      {activeModule === "conocimiento" && <ConocimientoModule />}
    </AppShell>
  );
}
