import { useMemo, useState } from "react";
import { ArrowRight, FileText, MapPin } from "lucide-react";
import { BpmnViewer } from "../BpmnViewer";
import type { Company } from "../../api";

const CAT_LABEL: Record<string, string> = {
  estrategico: "Estratégicos",
  operativo: "Operativos",
  apoyo: "Apoyo",
};

type BpmnMeta = { name: string; mapItemId: string };
function metaKey(companyId: string) { return `bpms_bpmn_meta_${companyId}`; }
function loadMeta(companyId: string): BpmnMeta {
  try { const raw = localStorage.getItem(metaKey(companyId)); if (raw) return JSON.parse(raw) as BpmnMeta; } catch { /* ignore */ }
  return { name: "", mapItemId: "" };
}

const STARTER = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Inicio" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="180" y="120" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

type Side = "asis" | "tobe";

/**
 * BpmnTab — dos apartados (AS-IS / TO-BE), cada uno con el editor BPMN propio.
 * Persiste el XML por empresa en localStorage al editar (vía onChange, sin remount).
 */
export function BpmnTab({ company }: { company: Company }) {
  const [side, setSide] = useState<Side>("asis");
  const [meta, setMeta] = useState<BpmnMeta>(() => loadMeta(company.id));
  const storageKey = `bpms_bpmn_${side}_${company.id}`;

  // Se relee de localStorage al cambiar de lado.
  const initialXml = useMemo(
    () => localStorage.getItem(storageKey) || STARTER,
    [storageKey],
  );

  function patchMeta(p: Partial<BpmnMeta>) {
    setMeta((m) => {
      const next = { ...m, ...p };
      try { localStorage.setItem(metaKey(company.id), JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  // Procesos del mapa agrupados por categoría (para el selector "pertenece a").
  const mapItems = company.mapa_procesos ?? [];

  function copyAsisToTobe() {
    const asis = localStorage.getItem(`bpms_bpmn_asis_${company.id}`) || STARTER;
    localStorage.setItem(`bpms_bpmn_tobe_${company.id}`, asis);
    setSide("tobe");
  }

  return (
    <div className="bpmn-tab">
      {/* Identidad del diagrama: nombre (compartido AS-IS/TO-BE) + ubicación en el mapa */}
      <div className="bpmn-identity">
        <label className="bpmn-identity-field bpmn-identity-name">
          <span><FileText size={13} /> Nombre del proceso</span>
          <input
            type="text"
            value={meta.name}
            placeholder="Ej. Registro de matrimonio"
            onChange={(e) => patchMeta({ name: e.target.value })}
          />
        </label>
        <label className="bpmn-identity-field bpmn-identity-map">
          <span><MapPin size={13} /> Pertenece a (mapa de procesos)</span>
          <select value={meta.mapItemId} onChange={(e) => patchMeta({ mapItemId: e.target.value })}>
            <option value="">— Sin ubicar —</option>
            {(["estrategico", "operativo", "apoyo"] as const).map((cat) => {
              const group = mapItems.filter((i) => i.categoria === cat);
              if (group.length === 0) return null;
              return (
                <optgroup key={cat} label={CAT_LABEL[cat]}>
                  {group.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
                </optgroup>
              );
            })}
          </select>
        </label>
        {mapItems.length === 0 && (
          <p className="bpmn-identity-hint muted">Define tu mapa de procesos en la pestaña «Mapa de procesos» para poder ubicar aquí el diagrama.</p>
        )}
      </div>

      <div className="bpmn-tab-bar">
        <div className="bpmn-toggle">
          <button type="button" className={`bpmn-toggle-btn ${side === "asis" ? "active" : ""}`}
            onClick={() => setSide("asis")}>AS-IS <span className="muted">(actual)</span></button>
          <button type="button" className={`bpmn-toggle-btn ${side === "tobe" ? "active" : ""}`}
            onClick={() => setSide("tobe")}>TO-BE <span className="muted">(propuesto)</span></button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="ghost-button" onClick={copyAsisToTobe} title="Copiar el AS-IS como base del TO-BE">
            Partir del AS-IS <ArrowRight size={13} />
          </button>
        </div>
      </div>

      <p className="muted bpmn-tab-hint">
        {side === "asis"
          ? "Modela el proceso tal como ocurre hoy. Se guarda automáticamente al editar."
          : "Diseña el proceso mejorado. Se guarda automáticamente al editar."}
      </p>

      <BpmnViewer
        key={side}
        xml={initialXml}
        height={560}
        scenario={side}
        companyId={company.id}
        onChange={(xml) => { try { localStorage.setItem(storageKey, xml); } catch { /* ignore */ } }}
      />
    </div>
  );
}
