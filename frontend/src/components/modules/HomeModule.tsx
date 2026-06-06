import { useEffect, useState } from "react";
import {
  Building2, CalendarRange, CheckCircle2, Compass, Eye, Gauge, Heart,
  Loader2, Plus, Route, Save, Target, Trash2,
} from "lucide-react";
import { updateCompany, type Company, type Kpi, type PoaItem } from "../../api";

type Props = {
  company: Company;
  onCompanyUpdated: (c: Company) => void;
};

const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * HomeModule (Inicio) — Contexto organizacional / planificación estratégica.
 * Edita misión, visión, valores, estrategias, objetivos estratégicos, KPIs y POA.
 * Es el contexto que la IA workspace lee para diseñar el mapa de procesos.
 */
export function HomeModule({ company, onCompanyUpdated }: Props) {
  const [draft, setDraft] = useState<Company>(company);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setDraft(company); }, [company.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function patch<K extends keyof Company>(key: K, value: Company[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSavedAt(null);
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const updated = await updateCompany(company.id, {
        razon_social: draft.razon_social,
        nombre_corto: draft.nombre_corto ?? undefined,
        sector: draft.sector ?? undefined,
        tamano: draft.tamano ?? undefined,
        mision: draft.mision ?? undefined,
        vision: draft.vision ?? undefined,
        valores: draft.valores ?? undefined,
        objetivos_estrategicos: draft.objetivos_estrategicos,
        estrategias: draft.estrategias,
        kpis: draft.kpis,
        poa: draft.poa,
      });
      onCompanyUpdated(updated);
      setDraft(updated);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="org-module">
      <header className="modeler-header org-header">
        <div>
          <h1><Building2 size={22} style={{ verticalAlign: "middle", marginRight: 8 }} />Organización</h1>
          <p className="muted">Planificación estratégica — el contexto que la IA usa para diseñar el mapa de procesos</p>
        </div>
        <div className="org-save-bar">
          {err && <span className="form-error" style={{ marginRight: 8 }}>{err}</span>}
          {savedAt && <span className="org-saved"><CheckCircle2 size={14} /> Guardado {savedAt}</span>}
          <button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </header>

      {/* Identidad */}
      <section className="org-card">
        <h2 className="org-card-title"><Building2 size={16} /> Identidad</h2>
        <div className="org-grid-2">
          <label className="org-field">Razón social
            <input value={draft.razon_social} onChange={(e) => patch("razon_social", e.target.value)} />
          </label>
          <label className="org-field">Nombre corto
            <input value={draft.nombre_corto ?? ""} onChange={(e) => patch("nombre_corto", e.target.value)} />
          </label>
          <label className="org-field">Sector
            <input value={draft.sector ?? ""} onChange={(e) => patch("sector", e.target.value)} />
          </label>
          <label className="org-field">Tamaño
            <select value={draft.tamano ?? ""} onChange={(e) => patch("tamano", e.target.value)}>
              <option value="">—</option>
              <option value="micro">Micro</option>
              <option value="pequeña">Pequeña</option>
              <option value="mediana">Mediana</option>
              <option value="grande">Grande</option>
            </select>
          </label>
        </div>
      </section>

      {/* Misión / Visión / Valores */}
      <div className="org-grid-3">
        <TextCard icon={Compass} title="Misión" value={draft.mision ?? ""}
          placeholder="¿Para qué existe la organización?" onChange={(v) => patch("mision", v)} />
        <TextCard icon={Eye} title="Visión" value={draft.vision ?? ""}
          placeholder="¿Qué aspira a ser en el futuro?" onChange={(v) => patch("vision", v)} />
        <TextCard icon={Heart} title="Valores" value={draft.valores ?? ""}
          placeholder="Principios que guían el comportamiento (uno por línea)" onChange={(v) => patch("valores", v)} />
      </div>

      {/* Estrategias + Objetivos */}
      <div className="org-grid-2">
        <ListCard icon={Route} title="Estrategias" accent="var(--blue)"
          items={draft.estrategias} placeholder="Nueva estrategia…"
          onChange={(items) => patch("estrategias", items)} />
        <ListCard icon={Target} title="Objetivos estratégicos" accent="var(--teal)"
          items={draft.objetivos_estrategicos} placeholder="Nuevo objetivo estratégico…"
          onChange={(items) => patch("objetivos_estrategicos", items)} />
      </div>

      {/* KPIs */}
      <KpiCard kpis={draft.kpis} onChange={(kpis) => patch("kpis", kpis)} />

      {/* POA */}
      <PoaCard poa={draft.poa} objetivos={draft.objetivos_estrategicos}
        onChange={(poa) => patch("poa", poa)} />
    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function TextCard({ icon: Icon, title, value, placeholder, onChange }: {
  icon: typeof Compass; title: string; value: string; placeholder: string; onChange: (v: string) => void;
}) {
  return (
    <section className="org-card">
      <h2 className="org-card-title"><Icon size={16} /> {title}</h2>
      <textarea className="org-textarea" rows={5} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </section>
  );
}

function ListCard({ icon: Icon, title, accent, items, placeholder, onChange }: {
  icon: typeof Route; title: string; accent: string; items: string[]; placeholder: string;
  onChange: (items: string[]) => void;
}) {
  const [input, setInput] = useState("");
  function add() {
    const v = input.trim(); if (!v) return;
    onChange([...items, v]); setInput("");
  }
  return (
    <section className="org-card">
      <h2 className="org-card-title" style={{ color: accent }}><Icon size={16} /> {title}</h2>
      <ul className="org-list">
        {items.length === 0 && <li className="muted org-list-empty">Aún no hay elementos.</li>}
        {items.map((it, i) => (
          <li key={i} className="org-list-item">
            <span className="org-list-bullet" style={{ background: accent }} />
            <input value={it} onChange={(e) => {
              const next = [...items]; next[i] = e.target.value; onChange(next);
            }} />
            <button type="button" className="org-icon-btn" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
      <div className="org-add-row">
        <input value={input} placeholder={placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="ghost-button" onClick={add}><Plus size={13} /> Añadir</button>
      </div>
    </section>
  );
}

function KpiCard({ kpis, onChange }: { kpis: Kpi[]; onChange: (k: Kpi[]) => void }) {
  function addRow() {
    onChange([...kpis, { id: newId(), nombre: "", meta: "", unidad: "", frecuencia: "mensual", responsable: "" }]);
  }
  function setCell(i: number, key: keyof Kpi, value: string) {
    const next = [...kpis]; next[i] = { ...next[i], [key]: value }; onChange(next);
  }
  return (
    <section className="org-card">
      <h2 className="org-card-title"><Gauge size={16} /> KPIs principales</h2>
      <table className="org-table">
        <thead><tr><th>Indicador</th><th>Meta</th><th>Unidad</th><th>Frecuencia</th><th>Responsable</th><th></th></tr></thead>
        <tbody>
          {kpis.length === 0 && <tr><td colSpan={6} className="muted">Sin KPIs. Añade el primero.</td></tr>}
          {kpis.map((k, i) => (
            <tr key={k.id}>
              <td><input value={k.nombre} onChange={(e) => setCell(i, "nombre", e.target.value)} placeholder="Ej. Satisfacción del cliente" /></td>
              <td><input value={k.meta} onChange={(e) => setCell(i, "meta", e.target.value)} placeholder="95" /></td>
              <td><input value={k.unidad} onChange={(e) => setCell(i, "unidad", e.target.value)} placeholder="%" /></td>
              <td>
                <select value={k.frecuencia} onChange={(e) => setCell(i, "frecuencia", e.target.value)}>
                  <option value="diaria">Diaria</option><option value="semanal">Semanal</option>
                  <option value="mensual">Mensual</option><option value="trimestral">Trimestral</option>
                  <option value="anual">Anual</option>
                </select>
              </td>
              <td><input value={k.responsable} onChange={(e) => setCell(i, "responsable", e.target.value)} placeholder="Área / persona" /></td>
              <td><button type="button" className="org-icon-btn" onClick={() => onChange(kpis.filter((_, j) => j !== i))}><Trash2 size={13} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="ghost-button" onClick={addRow}><Plus size={13} /> Añadir KPI</button>
    </section>
  );
}

function PoaCard({ poa, objetivos, onChange }: { poa: PoaItem[]; objetivos: string[]; onChange: (p: PoaItem[]) => void }) {
  function addRow() {
    onChange([...poa, { id: newId(), objetivo: "", actividad: "", responsable: "", periodo: "Q1", indicador: "", meta: "", presupuesto: "" }]);
  }
  function setCell(i: number, key: keyof PoaItem, value: string) {
    const next = [...poa]; next[i] = { ...next[i], [key]: value }; onChange(next);
  }
  return (
    <section className="org-card">
      <h2 className="org-card-title"><CalendarRange size={16} /> POA — Plan Operativo Anual</h2>
      <p className="muted" style={{ fontSize: ".8rem", margin: "0 0 10px" }}>
        Cada actividad operativa tributa a un objetivo estratégico.
      </p>
      <table className="org-table org-table-poa">
        <thead><tr><th>Objetivo</th><th>Actividad</th><th>Responsable</th><th>Periodo</th><th>Indicador</th><th>Meta</th><th>Presupuesto</th><th></th></tr></thead>
        <tbody>
          {poa.length === 0 && <tr><td colSpan={8} className="muted">Sin actividades. Añade la primera.</td></tr>}
          {poa.map((p, i) => (
            <tr key={p.id}>
              <td>
                <select value={p.objetivo} onChange={(e) => setCell(i, "objetivo", e.target.value)}>
                  <option value="">—</option>
                  {objetivos.map((o, j) => <option key={j} value={o}>{o.length > 40 ? o.slice(0, 40) + "…" : o}</option>)}
                </select>
              </td>
              <td><input value={p.actividad} onChange={(e) => setCell(i, "actividad", e.target.value)} placeholder="Actividad" /></td>
              <td><input value={p.responsable} onChange={(e) => setCell(i, "responsable", e.target.value)} placeholder="Responsable" /></td>
              <td>
                <select value={p.periodo} onChange={(e) => setCell(i, "periodo", e.target.value)}>
                  <option>Q1</option><option>Q2</option><option>Q3</option><option>Q4</option><option>Anual</option>
                </select>
              </td>
              <td><input value={p.indicador} onChange={(e) => setCell(i, "indicador", e.target.value)} placeholder="Indicador" /></td>
              <td><input value={p.meta} onChange={(e) => setCell(i, "meta", e.target.value)} placeholder="Meta" /></td>
              <td><input value={p.presupuesto} onChange={(e) => setCell(i, "presupuesto", e.target.value)} placeholder="$" /></td>
              <td><button type="button" className="org-icon-btn" onClick={() => onChange(poa.filter((_, j) => j !== i))}><Trash2 size={13} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="ghost-button" onClick={addRow}><Plus size={13} /> Añadir actividad</button>
    </section>
  );
}
