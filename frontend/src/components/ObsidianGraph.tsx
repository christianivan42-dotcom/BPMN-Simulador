import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { Loader2, Maximize2, RefreshCw, Search, Sparkles, X } from "lucide-react";
import {
  cognitiveAsk,
  getOrganizationGraph,
  type Company,
  type OrgGraph,
  type OrgGraphNode,
  type OrgGraphEdge,
} from "../api";
import { ChatMarkdown } from "./ChatMarkdown";

// ── Grafo construido desde lo que el usuario realmente crea ──────────────────
// (empresa → mapa de procesos por categoría → diagramas BPMN AS-IS/TO-BE).
const CAT_INFO: Record<string, string> = {
  estrategico: "Procesos estratégicos",
  operativo: "Procesos operativos",
  apoyo: "Procesos de apoyo",
};

/** ¿El XML tiene contenido real (más que el evento de inicio en blanco)? */
function hasRealDiagram(xml: string | null): boolean {
  if (!xml) return false;
  return /<bpmn:(task|userTask|serviceTask|manualTask|scriptTask|sendTask|receiveTask|businessRuleTask|exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway|endEvent|intermediateCatchEvent|intermediateThrowEvent|subProcess|callActivity)/i.test(xml);
}

function buildLocalOrgGraph(company: Company): OrgGraph {
  const nodes: OrgGraphNode[] = [];
  const edges: OrgGraphEdge[] = [];
  const companyId = `company:${company.id}`;
  nodes.push({
    id: companyId,
    label: company.nombre_corto || company.razon_social || "Mi organización",
    type: "company",
    sector: company.sector ?? null,
  });

  const items = company.mapa_procesos ?? [];
  const mapNodeId = (id: string) => `map:${id}`;
  for (const cat of ["estrategico", "operativo", "apoyo"] as const) {
    const group = items.filter((i) => i.categoria === cat);
    if (group.length === 0) continue;
    const catId = `cat:${cat}`;
    nodes.push({ id: catId, label: CAT_INFO[cat], type: "process", level: 0, area: cat });
    edges.push({ source: companyId, target: catId, rel: "categoría" });
    for (const it of group) {
      const nid = mapNodeId(it.id);
      nodes.push({ id: nid, label: it.nombre || "Proceso", type: "process", level: 1, area: cat });
      edges.push({ source: catId, target: nid, rel: "proceso" });
    }
  }

  // Diagrama BPMN: nombre + ubicación (compartidos por AS-IS/TO-BE) desde localStorage.
  // Se ubica BAJO el proceso del mapa elegido; si no, cuelga de la empresa.
  let meta: { name?: string; mapItemId?: string } = {};
  try { const raw = localStorage.getItem(`bpms_bpmn_meta_${company.id}`); if (raw) meta = JSON.parse(raw); } catch { /* ok */ }
  const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
  const dgName = (meta.name || "").trim();
  const locatedItem = meta.mapItemId ? items.find((i) => i.id === meta.mapItemId) : undefined;
  const parent = locatedItem ? mapNodeId(locatedItem.id) : companyId;
  const asis = read(`bpms_bpmn_asis_${company.id}`) ?? "";
  const tobe = read(`bpms_bpmn_tobe_${company.id}`) ?? "";
  const hasAsis = hasRealDiagram(asis);
  const hasTobe = hasRealDiagram(tobe);
  // Nodo "proceso BPMN" si hay nombre o algún diagrama modelado
  if (dgName || hasAsis || hasTobe) {
    const procId = `bpmnproc:${company.id}`;
    nodes.push({ id: procId, label: dgName || "Proceso BPMN", type: "process", level: 2, area: locatedItem?.categoria ?? null });
    edges.push({ source: parent, target: procId, rel: "modela" });
    if (hasAsis) {
      const id = `bpmn:asis:${company.id}`;
      nodes.push({ id, label: "Diagrama AS-IS", type: "artifact", artifact_type: "BPMN AS-IS" });
      edges.push({ source: procId, target: id, rel: "AS-IS" });
    }
    if (hasTobe) {
      const id = `bpmn:tobe:${company.id}`;
      nodes.push({ id, label: "Diagrama TO-BE", type: "artifact", artifact_type: "BPMN TO-BE" });
      edges.push({ source: procId, target: id, rel: "TO-BE" });
    }
  }

  const by_type: Record<string, number> = {};
  for (const n of nodes) by_type[n.type] = (by_type[n.type] ?? 0) + 1;
  return { nodes, edges, stats: { nodes: nodes.length, edges: edges.length, by_type } };
}

/* ────────────────────────────────────────────────────────────────────────────
 * ObsidianGraph — vista tipo Obsidian de TODA la memoria/registro de la empresa.
 * Usa react-force-graph-2d (open source, MIT) — la misma base que se usa para
 * replicar el grafo de Obsidian. Relaciona empresa, procesos N0–Nn, stakeholders,
 * entrevistas, elementos AS-IS, artefactos, documentos y la memoria cognitiva de
 * cada nodo. Incluye asistencia de IA contextual.
 * ──────────────────────────────────────────────────────────────────────────── */

const TYPE_STYLE: Record<string, { color: string; label: string; val: number }> = {
  company:     { color: "#0f766e", label: "Empresa",        val: 26 },
  process:     { color: "#2563eb", label: "Proceso",        val: 10 },
  stakeholder: { color: "#7c3aed", label: "Stakeholder",    val: 4 },
  interview:   { color: "#ea580c", label: "Entrevista",     val: 4 },
  asis:        { color: "#0891b2", label: "Elemento AS-IS", val: 3 },
  artifact:    { color: "#475569", label: "Artefacto",      val: 4 },
  memory:      { color: "#db2777", label: "Memoria IA",     val: 6 },
  document:    { color: "#a16207", label: "Documento",      val: 4 },
  overlay:     { color: "#16a34a", label: "Análisis",       val: 5 },
};
const LEVEL_COLOR = ["#d97706", "#2563eb", "#059669", "#0891b2", "#6366f1", "#64748b", "#94a3b8"];

// Paleta estable por área (color-by = "area")
const AREA_PALETTE = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#ca8a04", "#dc2626"];
function areaColor(area: string | null | undefined): string {
  if (!area) return "#94a3b8";
  let h = 0;
  for (let i = 0; i < area.length; i++) h = (h * 31 + area.charCodeAt(i)) >>> 0;
  return AREA_PALETTE[h % AREA_PALETTE.length];
}

type ColorMode = "level" | "area";
type GNode = OrgGraphNode & { x?: number; y?: number };
type GLink = { source: string; target: string; rel: string };

function nodeColor(n: OrgGraphNode, mode: ColorMode): string {
  if (n.type === "process") {
    return mode === "area" ? areaColor(n.area) : LEVEL_COLOR[Math.min(n.level ?? 1, LEVEL_COLOR.length - 1)];
  }
  return TYPE_STYLE[n.type]?.color ?? "#64748b";
}
function nodeVal(n: OrgGraphNode): number {
  if (n.type === "process") return n.level === 0 ? 24 : n.level === 1 ? 14 : 8;
  return TYPE_STYLE[n.type]?.val ?? 4;
}

export function ObsidianGraph({ company }: { company?: Company }) {
  const [graph, setGraph] = useState<OrgGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<OrgGraphNode | null>(null);
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [focusRootId, setFocusRootId] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("level");

  const wrapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const hoverRef = useRef<string | null>(null);
  const [, force] = useState(0);

  // ── Carga ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true); setErr(null);
    // Si tenemos la empresa, construimos el grafo desde lo que el usuario crea
    // (mapa de procesos + diagramas BPMN). Si no, caemos al grafo del backend.
    if (company) {
      try { setGraph(buildLocalOrgGraph(company)); }
      catch { setErr("No se pudo construir el mapa de conocimiento"); }
      setLoading(false);
      return;
    }
    getOrganizationGraph()
      .then(setGraph)
      .catch(() => setErr("No se pudo cargar el grafo de la organización"))
      .finally(() => setLoading(false));
  }, [reload, company]);

  // ── Tamaño responsivo ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(() => {
      const r = wrapRef.current!.getBoundingClientRect();
      setSize({ w: Math.max(320, r.width), h: Math.max(360, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Datos para la librería (estables: la lib muta x/y de cada nodo) ──────────
  const data = useMemo(() => {
    const nodes: GNode[] = (graph?.nodes ?? []).map((n) => ({ ...n }));
    const links: GLink[] = (graph?.edges ?? []).map((e) => ({ ...e }));
    return { nodes, links };
  }, [graph]);

  // ── Adyacencia para resaltado ────────────────────────────────────────────────
  const adj = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of graph?.edges ?? []) {
      (m.get(e.source) ?? m.set(e.source, new Set()).get(e.source)!).add(e.target);
      (m.get(e.target) ?? m.set(e.target, new Set()).get(e.target)!).add(e.source);
    }
    return m;
  }, [graph]);

  const matchIds = useMemo(() => {
    if (!query.trim() || !graph) return null;
    const q = query.trim().toLowerCase();
    return new Set(graph.nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
  }, [query, graph]);

  // ── Modo foco: subárbol de un proceso (ancestros + descendientes + relacionados)
  const focusSet = useMemo(() => {
    if (!focusRootId || !graph) return null;
    const HIER = new Set(["subproceso", "proceso"]);
    const set = new Set<string>([focusRootId]);
    // ancestros (subir por jerarquía)
    let frontier = [focusRootId];
    while (frontier.length) {
      const next: string[] = [];
      for (const e of graph.edges) {
        if (HIER.has(e.rel) && frontier.includes(e.target) && !set.has(e.source)) {
          set.add(e.source); next.push(e.source);
        }
      }
      frontier = next;
    }
    // descendientes (bajar por jerarquía)
    frontier = [focusRootId];
    while (frontier.length) {
      const next: string[] = [];
      for (const e of graph.edges) {
        if (e.rel === "subproceso" && frontier.includes(e.source) && !set.has(e.target)) {
          set.add(e.target); next.push(e.target);
        }
      }
      frontier = next;
    }
    // entidades enganchadas a cualquier proceso del subárbol
    for (const e of graph.edges) {
      if (set.has(e.source) && !set.has(e.target)) set.add(e.target);
    }
    return set;
  }, [focusRootId, graph]);

  // ── Datos visibles (filtro por tipo + foco), reutilizando objetos de nodo ─────
  const visibleData = useMemo(() => {
    const okNode = (n: GNode) =>
      !hiddenTypes.has(n.type) && (!focusSet || focusSet.has(n.id));
    const nodes = data.nodes.filter(okNode);
    const ids = new Set(nodes.map((n) => n.id));
    const endId = (v: unknown) => (typeof v === "object" && v !== null ? (v as GNode).id : (v as string));
    const links = data.links.filter((l) => ids.has(endId(l.source)) && ids.has(endId(l.target)));
    return { nodes, links };
  }, [data, hiddenTypes, focusSet]);

  function toggleType(t: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  }

  // Nodo "foco" = hover o seleccionado → resalta él + vecinos
  const focusId = hoverRef.current ?? selected?.id ?? null;
  const highlight = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    adj.get(focusId)?.forEach((x) => set.add(x));
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, adj, selected]);

  // ── Ajustar al cargar ────────────────────────────────────────────────────────
  const onEngineStop = useCallback(() => {
    fgRef.current?.zoomToFit?.(500, 60);
  }, []);

  // ── Dibujo de nodos (estilo Obsidian) ────────────────────────────────────────
  const drawNode = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any, ctx: CanvasRenderingContext2D, scale: number) => {
      const n = node as GNode;
      const r = Math.sqrt(nodeVal(n)) * 2.2;
      const dim = (highlight && !highlight.has(n.id)) || (matchIds && !matchIds.has(n.id));
      ctx.globalAlpha = dim ? 0.18 : 1;

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = nodeColor(n, colorMode);
      ctx.fill();
      if (selected?.id === n.id) {
        ctx.lineWidth = 2.5 / scale; ctx.strokeStyle = "#111827"; ctx.stroke();
      } else if (highlight?.has(n.id)) {
        ctx.lineWidth = 1.5 / scale; ctx.strokeStyle = "#0f766e"; ctx.stroke();
      } else {
        ctx.lineWidth = 1 / scale; ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.stroke();
      }

      const showLabel =
        n.type === "company" || n.type === "process" || scale > 1.6 ||
        highlight?.has(n.id) || matchIds?.has(n.id);
      if (showLabel) {
        const label = n.label.length > 28 ? n.label.slice(0, 26) + "…" : n.label;
        const fs = Math.max(3, 11 / scale);
        ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.lineWidth = 3 / scale; ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.strokeText(label, node.x, node.y + r + 1.5);
        ctx.fillStyle = "#1f2937";
        ctx.fillText(label, node.x, node.y + r + 1.5);
      }
      ctx.globalAlpha = 1;
    },
    [highlight, matchIds, selected, colorMode],
  );

  // Centrar la cámara en el primer nodo que coincide con la búsqueda.
  function centerOnSearch() {
    if (!matchIds || !graph) return;
    const hit = data.nodes.find((n) => matchIds.has(n.id)) as GNode | undefined;
    if (hit && hit.x != null && hit.y != null) {
      fgRef.current?.centerAt?.(hit.x, hit.y, 600);
      fgRef.current?.zoom?.(2.2, 600);
      setSelected(hit);
    }
  }

  const v = size;

  return (
    <div className="obsidian-wrap">
      <div className="obsidian-canvas" ref={wrapRef}>
        <div className="obsidian-toolbar">
          <div className="obsidian-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") centerOnSearch(); }}
              placeholder="Buscar nodo… (Enter centra)"
            />
            {query && <button onClick={() => setQuery("")}><X size={13} /></button>}
          </div>
          <button className="obsidian-btn" onClick={() => fgRef.current?.zoomToFit?.(500, 60)} title="Ajustar a la vista">
            <Maximize2 size={13} /> Ajustar
          </button>
          <button
            className="obsidian-btn"
            onClick={() => setColorMode((m) => (m === "level" ? "area" : "level"))}
            title="Alternar coloreado de procesos"
          >
            Color: {colorMode === "level" ? "Nivel" : "Área"}
          </button>
          <button className="obsidian-btn" onClick={() => setReload((r) => r + 1)} title="Recargar grafo">
            <RefreshCw size={13} /> Recargar
          </button>
          {focusRootId && (
            <button className="obsidian-focus-chip" onClick={() => setFocusRootId(null)} title="Salir del modo foco">
              Foco: {visibleData.nodes.length} nodos <X size={12} />
            </button>
          )}
          {graph && !focusRootId && (
            <span className="obsidian-stat">{visibleData.nodes.length} nodos · {visibleData.links.length} relaciones</span>
          )}
        </div>

        {loading && <div className="obsidian-center"><Loader2 className="spin" size={20} /> Cargando memoria…</div>}
        {err && !loading && <div className="obsidian-center form-error">{err}</div>}

        {graph && !loading && (
          <ForceGraph2D
            ref={fgRef}
            graphData={visibleData}
            width={v.w}
            height={v.h}
            backgroundColor="#f6faf9"
            nodeRelSize={4}
            nodeVal={(n: object) => nodeVal(n as GNode)}
            nodeColor={(n: object) => nodeColor(n as GNode, colorMode)}
            nodeLabel={(n: object) => (n as GNode).label}
            nodeCanvasObject={drawNode}
            nodePointerAreaPaint={(node: { x?: number; y?: number } & object, color: string, ctx: CanvasRenderingContext2D) => {
              const n = node as GNode;
              const r = Math.sqrt(nodeVal(n)) * 2.2 + 2;
              ctx.fillStyle = color;
              ctx.beginPath(); ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI); ctx.fill();
            }}
            linkColor={(l: object) => {
              const lk = l as { source: GNode | string; target: GNode | string };
              const s = typeof lk.source === "object" ? lk.source.id : lk.source;
              const t = typeof lk.target === "object" ? lk.target.id : lk.target;
              if (highlight && (highlight.has(s) && highlight.has(t))) return "#0f766e";
              return highlight ? "rgba(148,163,184,0.25)" : "rgba(148,163,184,0.55)";
            }}
            linkWidth={(l: object) => {
              const lk = l as { source: GNode | string; target: GNode | string };
              const s = typeof lk.source === "object" ? lk.source.id : lk.source;
              const t = typeof lk.target === "object" ? lk.target.id : lk.target;
              return highlight && highlight.has(s) && highlight.has(t) ? 2 : 1;
            }}
            linkDirectionalParticles={(l: object) => {
              const lk = l as { source: GNode | string; target: GNode | string };
              const s = typeof lk.source === "object" ? lk.source.id : lk.source;
              const t = typeof lk.target === "object" ? lk.target.id : lk.target;
              return highlight && highlight.has(s) && highlight.has(t) ? 2 : 0;
            }}
            linkDirectionalParticleWidth={2}
            linkDirectionalArrowLength={(l: object) => {
              const rel = (l as GLink).rel;
              return rel === "subproceso" || rel === "secuencia" || rel === "proceso" ? 3.5 : 0;
            }}
            linkDirectionalArrowRelPos={0.92}
            cooldownTicks={120}
            onEngineStop={onEngineStop}
            onNodeClick={(n: object) => setSelected(n as GNode)}
            onNodeHover={(n: object | null) => { hoverRef.current = (n as GNode | null)?.id ?? null; force((x) => x + 1); }}
            onBackgroundClick={() => setSelected(null)}
          />
        )}

        <div className="obsidian-legend">
          {Object.entries(TYPE_STYLE).map(([k, s]) => (
            <button
              key={k}
              type="button"
              className={`obsidian-legend-item ${hiddenTypes.has(k) ? "off" : ""}`}
              onClick={() => toggleType(k)}
              title={hiddenTypes.has(k) ? "Mostrar" : "Ocultar"}
            >
              <span className="obsidian-dot" style={{ background: s.color }} /> {s.label}
            </button>
          ))}
        </div>
      </div>

      <GraphSidePanel
        node={selected}
        onClose={() => setSelected(null)}
        focused={!!focusRootId && selected?.id === focusRootId}
        onFocus={() => selected && setFocusRootId(selected.id)}
        onClearFocus={() => setFocusRootId(null)}
      />
    </div>
  );
}

/* ── Panel de detalle + asistente IA ──────────────────────────────────────── */
function GraphSidePanel({
  node, onClose, focused, onFocus, onClearFocus,
}: {
  node: OrgGraphNode | null;
  onClose: () => void;
  focused: boolean;
  onFocus: () => void;
  onClearFocus: () => void;
}) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => { setAnswer(null); setQ(""); }, [node?.id]);

  const processCaseId = node?.type === "process" ? node.id.replace(/^case:/, "") : null;

  async function ask(question: string) {
    if (!question.trim()) return;
    setAsking(true); setAnswer(null);
    try {
      const ctx = node
        ? `[Contexto del grafo de conocimiento — nodo seleccionado: "${node.label}" (tipo: ${node.type}${node.area ? `, área: ${node.area}` : ""})]. `
        : "[Contexto: grafo de conocimiento de la organización]. ";
      const res = await cognitiveAsk(ctx + question, null, processCaseId);
      setAnswer(res.final_answer);
    } catch (e) {
      setAnswer(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAsking(false);
    }
  }

  if (!node) {
    return (
      <aside className="obsidian-side obsidian-side-empty">
        <Sparkles size={20} className="muted" />
        <p className="muted">Pulsa un nodo para ver su información y consultar al <strong>AI Workspace</strong> sobre él y sus relaciones.</p>
      </aside>
    );
  }

  const style = TYPE_STYLE[node.type];
  const suggestions = node.type === "process"
    ? ["¿Qué sé de este proceso y cómo se relaciona con los demás?", "¿Qué riesgos o brechas tiene?", "¿Qué falta por levantar aquí?"]
    : ["¿Qué representa este elemento y con qué se relaciona?", "Resume la información asociada."];

  return (
    <aside className="obsidian-side">
      <div className="obsidian-side-head">
        <span className="obsidian-side-type" style={{ background: style?.color }}>{style?.label ?? node.type}</span>
        <button className="obsidian-side-close" onClick={onClose}><X size={16} /></button>
      </div>
      <h3 className="obsidian-side-title">{node.label}</h3>
      <div className="obsidian-side-meta">
        {node.type === "process" && <span>Nivel N{node.level} · {node.area ?? "—"} · {node.analysis_status ?? ""}</span>}
        {node.type === "stakeholder" && node.role && <span>Rol: {node.role}</span>}
        {node.type === "artifact" && node.artifact_type && <span>{node.artifact_type}</span>}
        {node.type === "company" && node.sector && <span>Sector: {node.sector}</span>}
        {node.type === "memory" && <span>{node.sessions ?? 0} sesión(es) cognitivas</span>}
        {node.type === "overlay" && <span>{node.count ?? 0} marca(s) de {node.overlay_type}</span>}
      </div>

      {node.type === "process" && (
        focused
          ? <button className="obsidian-btn obsidian-focus-btn" onClick={onClearFocus}>Salir del foco</button>
          : <button className="obsidian-btn obsidian-focus-btn" onClick={onFocus}>🎯 Aislar subárbol</button>
      )}

      {node.type === "memory" && (
        <div className="obsidian-facts">
          <p className="obsidian-side-label">Hechos clave en memoria</p>
          {node.facts && node.facts.length > 0 ? (
            <ul>{node.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
          ) : (
            <p className="muted" style={{ fontSize: ".82rem" }}>
              Aún no hay hechos legibles acumulados. La memoria se enriquece a medida que
              analizas el proceso con la IA. Pregúntale abajo para generar y guardar hallazgos.
            </p>
          )}
        </div>
      )}

      <div className="obsidian-ai">
        <p className="obsidian-side-label"><Sparkles size={13} /> Pregunta a la IA</p>
        <div className="obsidian-suggestions">
          {suggestions.map((s, i) => (
            <button key={i} className="obsidian-chip" onClick={() => { setQ(s); void ask(s); }}>{s}</button>
          ))}
        </div>
        <div className="obsidian-ai-input">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void ask(q); }}
            placeholder={`Pregunta sobre "${node.label}"…`}
          />
          <button onClick={() => void ask(q)} disabled={asking || !q.trim()}>
            {asking ? <Loader2 size={14} className="spin" /> : "Enviar"}
          </button>
        </div>
        {asking && <p className="muted" style={{ fontSize: ".8rem" }}>El AI Workspace está analizando…</p>}
        {answer && <div className="obsidian-answer"><ChatMarkdown content={answer} /></div>}
      </div>
    </aside>
  );
}
