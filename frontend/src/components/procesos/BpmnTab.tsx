import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Cloud, CloudOff, FileText, Loader2, MapPin, Plus, Trash2, Workflow } from "lucide-react";
import { BpmnViewer } from "../BpmnViewer";
import {
  createBpmnDiagram,
  deleteBpmnDiagram,
  getBpmnDiagram,
  importBpmnDiagrams,
  listBpmnDiagrams,
  updateBpmnDiagram,
  type BpmnDiagramCreate,
  type BpmnDiagramSummary,
  type Company,
} from "../../api";
import { safeGet, safeRemove, safeSet, type SaveOutcome } from "../../lib/storage";

const CAT_LABEL: Record<string, string> = {
  estrategico: "Estratégicos",
  operativo: "Operativos",
  apoyo: "Apoyo",
};

type Side = "asis" | "tobe";

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

// ── Caché local (offline) ────────────────────────────────────────────────────
// El backend es ahora la fuente de verdad. localStorage se conserva como copia
// de seguridad: permite seguir viendo el último diagrama si el backend está
// caído, y guarda lo editado para no perderlo.
const cacheKey = (diagramId: string, side: Side) => `bpms_bpmn_cache_${side}_${diagramId}`;

// ── Claves del esquema antiguo, solo para migrar una vez ─────────────────────
const legacyIndexKey = (cid: string) => `bpms_bpmn_index_${cid}`;
const legacyDgmKey = (procId: string, side: Side) => `bpms_bpmn_${side}_${procId}`;
const MIGRATED_FLAG = (cid: string) => `bpms_bpmn_migrated_${cid}`;

interface LegacyProc { id: string; name?: string; mapItemId?: string }

/** Lee los diagramas que quedaron en el navegador con el esquema anterior. */
function readLegacyDiagrams(companyId: string): BpmnDiagramCreate[] {
  const out: BpmnDiagramCreate[] = [];
  let procs: LegacyProc[] = [];
  try {
    const raw = safeGet(legacyIndexKey(companyId));
    if (raw) procs = JSON.parse(raw) as LegacyProc[];
  } catch { /* índice corrupto */ }

  if (!Array.isArray(procs) || procs.length === 0) {
    // Esquema aún más antiguo: un único diagrama por empresa.
    const asis = safeGet(`bpms_bpmn_asis_${companyId}`);
    const tobe = safeGet(`bpms_bpmn_tobe_${companyId}`);
    if (asis || tobe) {
      let meta: { name?: string; mapItemId?: string } = {};
      try {
        const m = safeGet(`bpms_bpmn_meta_${companyId}`);
        if (m) meta = JSON.parse(m);
      } catch { /* ignore */ }
      out.push({
        company_id: companyId,
        name: (meta.name || "Proceso 1").trim(),
        map_item_id: meta.mapItemId || null,
        asis_xml: asis,
        tobe_xml: tobe,
      });
    }
    return out;
  }

  for (const [i, p] of procs.entries()) {
    out.push({
      company_id: companyId,
      name: (p.name || `Proceso ${i + 1}`).trim(),
      map_item_id: p.mapItemId || null,
      asis_xml: safeGet(legacyDgmKey(p.id, "asis")),
      tobe_xml: safeGet(legacyDgmKey(p.id, "tobe")),
      position: i,
    });
  }
  return out;
}

/**
 * BpmnTab — administra VARIOS procesos (cada uno con su AS-IS / TO-BE).
 *
 * Los diagramas se guardan en el backend, así que sobreviven al cambio de
 * navegador o de equipo. La primera vez migra automáticamente lo que hubiera en
 * localStorage.
 */
export function BpmnTab({ company }: { company: Company }) {
  const [diagrams, setDiagrams] = useState<BpmnDiagramSummary[]>([]);
  const [currentId, setCurrentId] = useState<string>("");
  const [side, setSide] = useState<Side>("asis");
  const [xml, setXml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const current = diagrams.find((d) => d.id === currentId) ?? diagrams[0] ?? null;
  const mapItems = company.mapa_procesos ?? [];

  const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // ── Carga inicial: backend + migración desde el navegador ──────────────────
  // Esta carga CREA recursos (la migración y el primer proceso), así que debe
  // ejecutarse UNA sola vez por empresa. En desarrollo React StrictMode monta,
  // desmonta y vuelve a montar cada efecto; sin el guard salían dos "Proceso 1",
  // y con un flag `cancelled` al estilo habitual se descartaba el resultado de
  // la única ejecución válida y la pestaña se quedaba cargando para siempre.
  const bootstrappedFor = useRef<string | null>(null);
  useEffect(() => {
    if (bootstrappedFor.current === company.id) return;
    bootstrappedFor.current = company.id;

    async function bootstrap() {
      setLoading(true);
      setError(null);
      try {
        let list = await listBpmnDiagrams(company.id);

        // Migración única de lo que hubiera en localStorage.
        if (list.length === 0 && !safeGet(MIGRATED_FLAG(company.id))) {
          const legacy = readLegacyDiagrams(company.id);
          if (legacy.length > 0) {
            const imported = await importBpmnDiagrams(company.id, legacy);
            list = imported.map(({ asis_xml: _a, tobe_xml: _t, sim_config: _s, ...rest }) => rest);
          }
          safeSet(MIGRATED_FLAG(company.id), new Date().toISOString());
        }

        // Toda empresa arranca con al menos un proceso para poder modelar.
        if (list.length === 0) {
          const created = await createBpmnDiagram({
            company_id: company.id,
            name: "Proceso 1",
            asis_xml: STARTER,
          });
          const { asis_xml: _a, tobe_xml: _t, sim_config: _s, ...summary } = created;
          list = [summary];
        }

        setDiagrams(list);
        setCurrentId((prev) => (list.some((d) => d.id === prev) ? prev : list[0].id));
        setOffline(false);
      } catch (e) {
        // Si falló, se permite reintentar en el siguiente montaje.
        bootstrappedFor.current = null;
        setOffline(true);
        setError(
          `No se pudo contactar con el backend (${describe(e)}). ` +
          "Los cambios NO se están guardando en el servidor: exporta el diagrama a .bpmn.",
        );
      } finally {
        setLoading(false);
      }
    }

    void bootstrap();
  }, [company.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Carga del XML del escenario activo ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!current) { setXml(null); return; }

    async function load(diagramId: string, scenario: Side) {
      setXml(null); // fuerza el remontaje del editor mientras carga
      const cached = safeGet(cacheKey(diagramId, scenario));
      try {
        const full = await getBpmnDiagram(diagramId);
        if (cancelled) return;
        const stored = scenario === "asis" ? full.asis_xml : full.tobe_xml;
        setXml(stored || cached || STARTER);
        setOffline(false);
      } catch (e) {
        if (cancelled) return;
        setOffline(true);
        setError(
          `No se pudo cargar el diagrama desde el servidor (${describe(e)}). ` +
          "Se muestra la última copia local.",
        );
        setXml(cached || STARTER);
      }
    }

    void load(current.id, side);
    return () => { cancelled = true; };
  }, [current?.id, side]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Guardado del diagrama activo ──────────────────────────────────────────
  const saveXml = useCallback(
    async (nextXml: string): Promise<SaveOutcome> => {
      if (!current) return { ok: true };
      // La copia local se escribe siempre: es la red de seguridad.
      safeSet(cacheKey(current.id, side), nextXml);
      setSaving(true);
      try {
        await updateBpmnDiagram(current.id, side === "asis" ? { asis_xml: nextXml } : { tobe_xml: nextXml });
        setError(null);
        setOffline(false);
        return { ok: true };
      } catch (e) {
        const message =
          `No se pudo guardar en el servidor (${describe(e)}). ` +
          "El diagrama quedó en una copia local del navegador; exporta a .bpmn por seguridad.";
        setOffline(true);
        setError(message);
        return { ok: false, message };
      } finally {
        setSaving(false);
      }
    },
    [current, side],
  );

  // ── Metadatos (nombre / ubicación en el mapa), con rebote ─────────────────
  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function patchCurrent(patch: { name?: string; map_item_id?: string | null }) {
    if (!current) return;
    const id = current.id;
    setDiagrams((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    if (metaTimer.current) clearTimeout(metaTimer.current);
    metaTimer.current = setTimeout(() => {
      updateBpmnDiagram(id, patch).catch((e) => {
        setOffline(true);
        setError(`No se pudo guardar el nombre/ubicación del proceso (${describe(e)}).`);
      });
    }, 600);
  }
  useEffect(() => () => { if (metaTimer.current) clearTimeout(metaTimer.current); }, []);

  async function addProcess() {
    try {
      const created = await createBpmnDiagram({
        company_id: company.id,
        name: `Proceso ${diagrams.length + 1}`,
        asis_xml: STARTER,
      });
      const { asis_xml: _a, tobe_xml: _t, sim_config: _s, ...summary } = created;
      setDiagrams((ds) => [...ds, summary]);
      setCurrentId(created.id);
      setSide("asis");
      setError(null);
    } catch (e) {
      setError(`No se pudo crear el proceso (${describe(e)}).`);
    }
  }

  async function deleteCurrent() {
    if (!current) return;
    if (!confirm(`¿Eliminar el proceso "${current.name || "sin nombre"}" y sus diagramas AS-IS / TO-BE? Esta acción no se puede deshacer.`)) return;
    const id = current.id;
    try {
      await deleteBpmnDiagram(id);
    } catch (e) {
      setError(`No se pudo eliminar el proceso (${describe(e)}).`);
      return;
    }
    for (const s of ["asis", "tobe"] as const) {
      safeRemove(cacheKey(id, s));
      safeRemove(`bpms_sim_summary_${s}_${id}`);
      safeRemove(`bpms_sim_data_${s}_${id}`);
    }
    const rest = diagrams.filter((d) => d.id !== id);
    setDiagrams(rest);
    if (rest.length > 0) {
      setCurrentId(rest[0].id);
      setSide("asis");
    } else {
      await addProcess();
    }
  }

  async function copyAsisToTobe() {
    if (!current) return;
    try {
      const full = await getBpmnDiagram(current.id);
      const asis = full.asis_xml || STARTER;
      await updateBpmnDiagram(current.id, { tobe_xml: asis });
      safeSet(cacheKey(current.id, "tobe"), asis);
      setDiagrams((ds) => ds.map((d) => (d.id === current.id ? { ...d, has_tobe: true } : d)));
      setSide("tobe");
      setError(null);
    } catch (e) {
      setError(`No se pudo copiar el AS-IS al TO-BE (${describe(e)}).`);
    }
  }

  if (loading) {
    return (
      <div className="bpmn-tab bpmn-tab-loading">
        <Loader2 size={16} className="spin" /> Cargando diagramas…
      </div>
    );
  }

  return (
    <div className="bpmn-tab">
      {error && (
        <div className="bpmn-storage-warning" role="alert">
          <AlertTriangle size={15} />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Descartar aviso">×</button>
        </div>
      )}

      {/* Barra de procesos: seleccionar / crear / eliminar */}
      <div className="bpmn-procbar">
        <div className="bpmn-procbar-left">
          <Workflow size={15} />
          <span className="bpmn-procbar-label">Proceso:</span>
          <select
            className="bpmn-procbar-select"
            value={current?.id ?? ""}
            onChange={(e) => { setCurrentId(e.target.value); setSide("asis"); }}
          >
            {diagrams.map((d) => <option key={d.id} value={d.id}>{d.name || "Sin nombre"}</option>)}
          </select>
          <span className="bpmn-procbar-count">{diagrams.length} proceso{diagrams.length !== 1 ? "s" : ""}</span>
          <span className={`bpmn-sync ${offline ? "is-offline" : ""}`} title={offline ? "Sin conexión con el servidor" : "Guardado en el servidor"}>
            {saving ? <Loader2 size={12} className="spin" /> : offline ? <CloudOff size={12} /> : <Cloud size={12} />}
            {saving ? "Guardando…" : offline ? "Solo local" : "En el servidor"}
          </span>
        </div>
        <div className="bpmn-procbar-actions">
          <button type="button" className="ghost-button" onClick={() => void addProcess()} title="Crear un proceso nuevo">
            <Plus size={14} /> Nuevo proceso
          </button>
          <button type="button" className="ghost-button bpmn-del-btn" onClick={() => void deleteCurrent()} title="Eliminar este proceso">
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
          <select
            value={current?.map_item_id ?? ""}
            onChange={(e) => patchCurrent({ map_item_id: e.target.value || null })}
          >
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
          <button type="button" className="ghost-button" onClick={() => void copyAsisToTobe()} title="Copiar el AS-IS como base del TO-BE">
            Partir del AS-IS <ArrowRight size={13} />
          </button>
        </div>
      </div>

      <p className="muted bpmn-tab-hint">
        {side === "asis"
          ? "Modela el proceso tal como ocurre hoy. Se guarda automáticamente en el servidor al editar."
          : "Diseña el proceso mejorado. Se guarda automáticamente en el servidor al editar."}
      </p>

      {current && xml !== null ? (
        <BpmnViewer
          key={`${current.id}-${side}`}
          xml={xml}
          height={560}
          viewportKey={`${current.id}-${side}`}
          scenario={side}
          processId={current.id}
          processName={current.name}
          onChange={saveXml}
        />
      ) : (
        <div className="bpmn-tab-loading"><Loader2 size={16} className="spin" /> Cargando diagrama…</div>
      )}
    </div>
  );
}
