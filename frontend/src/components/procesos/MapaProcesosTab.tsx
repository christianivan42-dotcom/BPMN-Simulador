import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Plus, Save, Sparkles, Trash2, Workflow } from "lucide-react";
import {
  updateCompany,
  type Company,
  type ProcessMapCategory,
  type ProcessMapItem,
} from "../../api";

/** Lee el índice de procesos BPMN y los agrupa por ítem del mapa (mapItemId). */
function loadBpmnByItem(companyId: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  try {
    const raw = localStorage.getItem(`bpms_bpmn_index_${companyId}`);
    if (raw) {
      const arr = JSON.parse(raw) as Array<{ name?: string; mapItemId?: string }>;
      for (const p of arr) {
        if (p.mapItemId) (out[p.mapItemId] ??= []).push((p.name || "Proceso").trim() || "Proceso");
      }
    }
  } catch { /* ignore */ }
  return out;
}

const CATS: Array<{ id: ProcessMapCategory; label: string; color: string; hint: string }> = [
  { id: "estrategico", label: "Procesos estratégicos", color: "var(--teal)", hint: "Dirección, planificación y mejora" },
  { id: "operativo", label: "Procesos operativos (cadena de valor)", color: "var(--blue)", hint: "Generan el producto/servicio al cliente" },
  { id: "apoyo", label: "Procesos de apoyo", color: "var(--amber)", hint: "RR.HH., TI, finanzas, compras" },
];

const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * MapaProcesosTab — mapa de procesos (ISO-9001 style): 3 bandas estratégico /
 * operativo / apoyo. Edición manual + "Diseñar con IA" que lee el contexto de la
 * organización (cadena de valor + objetivos) y dibuja el mapa en pantalla.
 */
export function MapaProcesosTab({ company, onCompanyUpdated }: {
  company: Company; onCompanyUpdated: (c: Company) => void;
}) {
  const [items, setItems] = useState<ProcessMapItem[]>(company.mapa_procesos);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Procesos BPMN modelados, agrupados por el ítem del mapa al que pertenecen.
  const bpmnByItem = useMemo(() => loadBpmnByItem(company.id), [company.id]);

  useEffect(() => { setItems(company.mapa_procesos); }, [company.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function add(cat: ProcessMapCategory) {
    setItems((p) => [...p, { id: newId(), nombre: "Nuevo proceso", descripcion: "", categoria: cat }]);
    setSavedAt(null);
  }
  function patch(id: string, p: Partial<ProcessMapItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
    setSavedAt(null);
  }
  function remove(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setSavedAt(null);
  }

  /** Diseña el mapa desde el contexto de la organización (determinista, sin alucinar). */
  function designFromContext() {
    const out: ProcessMapItem[] = [
      { id: newId(), nombre: "Planificación estratégica", descripcion: "Definición de objetivos y seguimiento del POA", categoria: "estrategico" },
      { id: newId(), nombre: "Gestión de la calidad y mejora continua", descripcion: "", categoria: "estrategico" },
    ];
    for (const a of company.cadena_valor.actividades_primarias) {
      out.push({ id: newId(), nombre: a.nombre, descripcion: a.descripcion, categoria: "operativo" });
    }
    for (const a of company.cadena_valor.actividades_apoyo) {
      out.push({ id: newId(), nombre: a.nombre, descripcion: a.descripcion, categoria: "apoyo" });
    }
    setItems(out);
    setSavedAt(null);
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const updated = await updateCompany(company.id, { mapa_procesos: items });
      onCompanyUpdated(updated);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mapa-proc">
      <div className="mapa-proc-head">
        <p className="muted" style={{ margin: 0, fontSize: ".82rem" }}>
          El mapa de procesos de tu organización. Edítalo a mano o deja que la IA lo proponga desde tu contexto.
        </p>
        <div className="mapa-proc-actions">
          {err && <span className="form-error" style={{ marginRight: 8 }}>{err}</span>}
          {savedAt && <span className="org-saved"><CheckCircle2 size={14} /> Guardado {savedAt}</span>}
          <button type="button" className="ghost-button" onClick={designFromContext}>
            <Sparkles size={14} /> Diseñar con IA
          </button>
          <button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      <div className="mapa-proc-bands">
        {CATS.map((cat) => {
          const boxes = items.filter((i) => i.categoria === cat.id);
          return (
            <section key={cat.id} className="mapa-band" style={{ borderLeftColor: cat.color }}>
              <header className="mapa-band-head">
                <div>
                  <strong style={{ color: cat.color }}>{cat.label}</strong>
                  <span className="muted mapa-band-hint">{cat.hint}</span>
                </div>
                <button type="button" className="org-icon-btn mapa-add" onClick={() => add(cat.id)} title="Añadir proceso">
                  <Plus size={14} />
                </button>
              </header>
              <div className="mapa-boxes">
                {boxes.length === 0 && <p className="muted mapa-empty">Sin procesos. Pulsa + o «Diseñar con IA».</p>}
                {boxes.map((b) => {
                  const procs = bpmnByItem[b.id] ?? [];
                  return (
                    <div key={b.id} className="mapa-box" style={{ borderTopColor: cat.color }}>
                      <button type="button" className="mapa-box-del" onClick={() => remove(b.id)}><Trash2 size={12} /></button>
                      <input className="mapa-box-name" value={b.nombre}
                        onChange={(e) => patch(b.id, { nombre: e.target.value })} />
                      <input className="mapa-box-desc" value={b.descripcion} placeholder="Descripción…"
                        onChange={(e) => patch(b.id, { descripcion: e.target.value })} />
                      {procs.length > 0 && (
                        <div className="mapa-box-bpmn" title="Procesos BPMN modelados aquí (edítalos en la pestaña BPMN)">
                          {procs.map((name, i) => (
                            <span key={i} className="mapa-bpmn-chip"><Workflow size={11} /> {name}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
