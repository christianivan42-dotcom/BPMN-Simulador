import { useState } from "react";
import { GitBranch, Layers, Map } from "lucide-react";
import { MapaProcesosTab } from "../procesos/MapaProcesosTab";
import { BpmnTab } from "../procesos/BpmnTab";
import type { Company } from "../../api";

export type ProcesosStep = "mapa" | "bpmn";

const TABS: Array<{ id: ProcesosStep; label: string; icon: typeof Map }> = [
  { id: "mapa", label: "Mapa de procesos", icon: Map },
  { id: "bpmn", label: "BPMN", icon: GitBranch },
];

type Props = {
  company: Company;
  onCompanyUpdated: (c: Company) => void;
  initialStep?: ProcesosStep;
  onStepChange?: (step: ProcesosStep) => void;
};

export function ProcesosModule({ company, onCompanyUpdated, initialStep = "mapa", onStepChange }: Props) {
  const [tab, setTab] = useState<ProcesosStep>(initialStep === "bpmn" ? "bpmn" : "mapa");

  function go(t: ProcesosStep) {
    setTab(t);
    onStepChange?.(t);
  }

  return (
    <div className="procesos-module">
      <header className="modeler-header">
        <div>
          <h1><Layers size={22} style={{ verticalAlign: "middle", marginRight: 8 }} />Procesos</h1>
          <p className="muted">Mapa de procesos de la organización y modelado BPMN (AS-IS / TO-BE)</p>
        </div>
      </header>

      <nav className="procesos-tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button"
              className={`procesos-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => go(t.id)}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="procesos-module-content">
        {tab === "mapa" && <MapaProcesosTab company={company} onCompanyUpdated={onCompanyUpdated} />}
        {tab === "bpmn" && <BpmnTab company={company} />}
      </div>
    </div>
  );
}
