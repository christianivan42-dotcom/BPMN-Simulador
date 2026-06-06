import { useMemo, useState } from "react";
import { ArrowRight, FileText, MapPin, Plus, Trash2, Workflow } from "lucide-react";
import { BpmnViewer } from "../BpmnViewer";
import type { Company } from "../../api";

const CAT_LABEL: Record<string, string> = {
  estrategico: "Estratégicos",
  operativo: "Operativos",
  apoyo: "Apoyo",
};

type Side = "asis" | "tobe";
interface BpmnProc { id: string; name: string; mapItemId: string; }

const indexKey = (cid: string) => `bpms_bpmn_index_${cid}`;
const dgmKey = (procId: string, side: Side) => `bpms_bpmn_${side}_${procId}`;
const newProcId = () => `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

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

function saveIndex(cid: string, procs: BpmnProc[]) {
  try { localStorage.setItem(indexKey(cid), JSON.stringify(procs)); } catch { /* ignore */ }
}

/** Carga el índice de procesos; migra el diagrama antiguo (mono-proceso) si existe. */
function loadProcs(cid: string): BpmnProc[] {
  try {
    const raw = localStorage.getItem(indexKey(cid));
    if (raw) {
      const arr = JSON.parse(raw) as BpmnProc[];
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch { /* ignore */ }
  // Migración desde el esquema antiguo (un solo diagrama por empresa)
  const oldAsis = localStorage.getItem(`bpms_bpmn_asis_${cid}`);
  const oldTobe = localStorage.getItem(`bpms_bpmn_tobe_${cid}`);
  let oldMeta: { name?: string; mapItemId?: string } = {};
  try { const m = localStorage.getItem(`bpms_bpmn_meta_${cid}`); if (m) oldMeta = JSON.parse(m); } catch { /* ignore */ }
  if (oldAsis || oldTobe || oldMeta.name) {
    const id = newProcId();
    if (oldAsis) try { localStorage.setItem(dgmKey(id, "asis"), oldAsis); } catch { /* ignore */ }
    if (oldTobe) try { localStorage.setItem(dgmKey(id, "tobe"), oldTobe); } catch { /* ignore */ }
    const proc: BpmnProc = { id, name: (oldMeta.name || "Proceso 1").trim(), mapItemId: oldMeta.mapItemId || "" };
    saveIndex(cid, [proc]);
    return [proc];
  }
  // Primer proceso por defecto
  const first: BpmnProc = { id: newProcId(), name: "Proceso 1", mapItemId: "" };
  saveIndex(cid, [first]);
  return [first];
}

/**
 * BpmnTab — administra VARIOS procesos (cada uno con su AS-IS / TO-BE).
 * Permite crear, seleccionar, nombrar, ubicar en el mapa y eliminar procesos.
 */
export function BpmnTab({ company }: { company: Company }) {
  const [procs, setProcs] = useState<BpmnProc[]>(() => loadProcs(company.id));
  const [currentId, setCurrentId] = useState<string>(() => procs[0]?.id ?? "");
  const [side, setSide] = useState<Side>("asis");

  const current = procs.find((p) => p.id === currentId) ?? procs[0];
  const storageKey = current ? dgmKey(current.id, side) : "";

  // Se relee de localStorage al cambiar de proceso o de lado.
  const initialXml = useMemo(
    () => (storageKey ? localStorage.getItem(storageKey) || STARTER : STARTER),
    [storageKey],
  );

  const mapItems = company.mapa_procesos ?? [];

  function persist(next: BpmnProc[]) { setProcs(next); saveIndex(company.id, next); }

  function patchCurrent(p: Partial<BpmnProc>) {
    if (!current) return;
    persist(procs.map((x) => (x.id === current.id ? { ...x, ...p } : x)));
  }

  function addProcess() {
    const id = newProcId();
    const p: BpmnProc = { id, name: `Proceso ${procs.length + 1}`, mapItemId: "" };
    persist([...procs, p]);
    setCurrentId(id);
    setSide("asis");
  }

  function deleteCurrent() {
    if (!current) return;
    if (!confirm(`¿Eliminar el proceso "${current.name || "sin nombre"}" y sus diagramas AS-IS / TO-BE? Esta acción no se puede deshacer.`)) return;
    try {
      localStorage.removeItem(dgmKey(current.id, "asis"));
      localStorage.removeItem(dgmKey(current.id, "tobe"));
      localStorage.removeItem(`bpms_sim_summary_asis_${current.id}`);
      localStorage.removeItem(`bpms_sim_summary_tobe_${current.id}`);
      localStorage.removeItem(`bpms_sim_data_asis_${current.id}`);
      localStorage.removeItem(`bpms_sim_data_tobe_${current.id}`);
    } catch { /* ignore */ }
    let next = procs.filter((x) => x.id !== current.id);
    if (next.length === 0) next = [{ id: newProcId(), name: "Proceso 1", mapItemId: "" }];
    persist(next);
    setCurrentId(next[0].id);
    setSide("asis");
  }

  function copyAsisToTobe() {
    if (!current) return;
    const asis = localStorage.getItem(dgmKey(current.id, "asis")) || STARTER;
    try { localStorage.setItem(dgmKey(current.id, "tobe"), asis); } catch { /* ignore */ }
    setSide("tobe");
  }

  return (
    <div className="bpmn-tab">
      {/* Barra de procesos: seleccionar / crear / eliminar */}
      <div className="bpmn-procbar">
        <div className="bpmn-procbar-left">
          <Workflow size={15} />
          <span className="bpmn-procbar-label">Proceso:</span>
          <select className="bpmn-procbar-select" value={current?.id ?? ""} onChange={(e) => { setCurrentId(e.target.value); setSide("asis"); }}>
            {procs.map((p) => <option key={p.id} value={p.id}>{p.name || "Sin nombre"}</option>)}
          </select>
          <span className="bpmn-procbar-count">{procs.length} proceso{procs.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="bpmn-procbar-actions">
          <button type="button" className="ghost-button" onClick={addProcess} title="Crear un proceso nuevo">
            <Plus size={14} /> Nuevo proceso
          </button>
          <button type="button" className="ghost-button bpmn-del-btn" onClick={deleteCurrent} title="Eliminar este proceso">
            <Trash2 size={14} /> Eliminar
          </button>
        </div>
      </div>

      {/* Identidad del proceso: nombre + ubicación en el mapa */}
      <div className="bpmn-identity">
        <label className="bpmn-identity-field bpmn-identity-name">
          <span><FileText size={13} /> Nombre del proceso</span>
          <input
            type="text"
            value={current?.name ?? ""}
            placeholder="Ej. Registro de matrimonio"
            onChange={(e) => patchCurrent({ name: e.target.value })}
          />
        </label>
        <label className="bpmn-identity-field bpmn-identity-map">
          <span><MapPin size={13} /> Pertenece a (mapa de procesos)</span>
          <select value={current?.mapItemId ?? ""} onChange={(e) => patchCurrent({ mapItemId: e.target.value })}>
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
          <p className="bpmn-identity-hint muted">Define tu mapa de procesos en la pestaña «Mapa de procesos» para poder ubicar aquí el proceso.</p>
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

      {current && (
        <BpmnViewer
          key={`${current.id}-${side}`}
          xml={initialXml}
          height={560}
          scenario={side}
          processId={current.id}
          processName={current.name}
          onChange={(xml) => { try { localStorage.setItem(storageKey, xml); } catch { /* ignore */ } }}
        />
      )}
    </div>
  );
}
