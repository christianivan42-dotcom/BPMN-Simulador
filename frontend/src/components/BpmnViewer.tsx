import BpmnModeler from "bpmn-js/lib/Modeler";
import bpmnColorPickerModule from "bpmn-js-color-picker";
import minimapModule from "diagram-js-minimap";
import fullPaletteModule from "../bpmn/fullPaletteModule";
import { Copy, Download, FileDown, FileUp, FilePlus, Loader2, Maximize2, Minimize2, Minus, Plus, Redo2, Save, Undo2, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { saveBpmn, type BpmnOverlay, type SaveBpmnResponse } from "../api";
import { SimulationPanel } from "./procesos/SimulationPanel";

// ── Namespace URIs ────────────────────────────────────────────────────────────
const NS_BPMN   = "http://www.omg.org/spec/BPMN/20100524/MODEL";
const NS_BPMNDI = "http://www.omg.org/spec/BPMN/20100524/DI";
const NS_DC     = "http://www.omg.org/spec/DD/20100524/DC";
const NS_DI     = "http://www.omg.org/spec/DD/20100524/DI";

const ALL_NS = [
  `xmlns:bpmn="${NS_BPMN}"`,
  `xmlns:bpmndi="${NS_BPMNDI}"`,
  `xmlns:dc="${NS_DC}"`,
  `xmlns:di="${NS_DI}"`,
  `targetNamespace="http://bpmn.io/schema/bpmn"`,
].join(" ");

// Diagrama en blanco SIEMPRE válido (con DI). Respaldo cuando el XML no tiene
// elementos reconocibles o falla la importación, para no mostrar "no diagram to display".
const BLANK_DIAGRAM = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${ALL_NS}>
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

// ── BPMN node types known to bpmn-js ─────────────────────────────────────────
const NODE_TYPES = [
  "startEvent","endEvent","task","userTask","serviceTask","scriptTask",
  "manualTask","sendTask","receiveTask","businessRuleTask",
  "exclusiveGateway","inclusiveGateway","parallelGateway","eventBasedGateway",
  "complexGateway","subProcess","callActivity",
  "intermediateCatchEvent","intermediateThrowEvent","boundaryEvent",
];

// Element visual dimensions
function elSize(type: string): { w: number; h: number } {
  if (type.includes("Gateway")) return { w: 50, h: 50 };
  if (type.includes("Event"))   return { w: 36, h: 36 };
  return { w: 100, h: 80 };
}

// ── Step 1: Fix namespace prefix ─────────────────────────────────────────────
function fixNamespaces(raw: string): string {
  let xml = raw;

  // Case A: already has bpmn: prefix — just ensure all namespace attrs are present
  if (xml.includes("bpmn:definitions") || xml.includes("bpmn2:definitions")) {
    return xml.replace(/<(?:bpmn:?|bpmn2:?)definitions([^>]*)>/, (_m, attrs) => {
      let a = attrs;
      if (!a.includes("xmlns:bpmn="))   a = ` xmlns:bpmn="${NS_BPMN}"` + a;
      if (!a.includes("xmlns:bpmndi=")) a += ` xmlns:bpmndi="${NS_BPMNDI}"`;
      if (!a.includes("xmlns:dc="))     a += ` xmlns:dc="${NS_DC}"`;
      if (!a.includes("xmlns:di="))     a += ` xmlns:di="${NS_DI}"`;
      if (!a.includes("targetNamespace=")) a += ` targetNamespace="http://bpmn.io/schema/bpmn"`;
      return `<bpmn:definitions${a}>`;
    });
  }

  // Case B: plain <definitions> (no prefix) — replace namespace, add prefix
  if (xml.includes("<definitions")) {
    xml = xml.replace(/<definitions([^>]*)>/, (_m, attrs) => {
      // strip conflicting default xmlns/targetNamespace
      const cleaned = (attrs ?? "")
        .replace(/\s+xmlns="[^"]*"/g, "")
        .replace(/\s+targetNamespace="[^"]*"/g, "")
        .trim();
      return `<bpmn:definitions ${ALL_NS}${cleaned ? " " + cleaned : ""}>`;
    });
    xml = xml.replace(/<\/definitions>/g, "</bpmn:definitions>");

    // Prefix all known element names
    for (const t of [...NODE_TYPES, "sequenceFlow"]) {
      xml = xml.replace(new RegExp(`<(${t})(\\s|>|/)`, "g"), `<bpmn:${t}$2`);
      xml = xml.replace(new RegExp(`</${t}>`,           "g"), `</bpmn:${t}>`);
    }
  }

  return xml;
}

// ── Step 2: Strip any existing (possibly malformed) BPMNDiagram ──────────────
function stripDiagram(xml: string): string {
  return xml
    .replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/gi, "")
    .replace(/<BPMNDiagram[\s\S]*?<\/BPMNDiagram>/gi, "")
    .trim();
}

// ── Step 3: Parse elements via REGEX (avoids DOMParser namespace issues) ──────
interface Elem { id: string; type: string }
interface Flow { id: string; source: string; target: string }
interface Parsed { processId: string; nodes: Elem[]; flows: Flow[] }

function parseElements(xml: string): Parsed {
  // Process ID
  const procMatch = xml.match(/<bpmn:process[^>]+\bid="([^"]+)"/);
  const processId = procMatch?.[1] ?? "Process_1";

  const nodes: Elem[] = [];
  const typePattern = NODE_TYPES.join("|");
  // Matches <bpmn:task id="..." or <bpmn2:task id="...
  const nodeRe = new RegExp(`<bpmn2?:(${typePattern})(?:\\s[^>]*)?>`, "g");
  let m: RegExpExecArray | null;
  while ((m = nodeRe.exec(xml)) !== null) {
    const type = m[1];
    const tag  = m[0];
    const idM  = tag.match(/\bid="([^"]+)"/);
    if (idM) nodes.push({ id: idM[1], type });
  }

  const flows: Flow[] = [];
  const flowRe = /<bpmn2?:sequenceFlow(?:\s[^>]*)?\/?>/g;
  while ((m = flowRe.exec(xml)) !== null) {
    const tag   = m[0];
    const idM   = tag.match(/\bid="([^"]+)"/);
    const srcM  = tag.match(/\bsourceRef="([^"]+)"/);
    const tgtM  = tag.match(/\btargetRef="([^"]+)"/);
    if (idM && srcM && tgtM)
      flows.push({ id: idM[1], source: srcM[1], target: tgtM[1] });
  }

  return { processId, nodes, flows };
}

// ── Step 4: Auto-layout (BFS left-to-right) ───────────────────────────────────
interface LayoutElem extends Elem { col: number; row: number }

function buildLayout(nodes: Elem[], flows: Flow[]): Map<string, LayoutElem> {
  const out = new Map<string, string[]>();
  const inc = new Map<string, number>();
  for (const n of nodes) { out.set(n.id, []); inc.set(n.id, 0); }
  for (const f of flows) {
    out.get(f.source)?.push(f.target);
    inc.set(f.target, (inc.get(f.target) ?? 0) + 1);
  }

  // Topological BFS rank
  const rank = new Map<string, number>();
  const queue = nodes
    .filter(n => (inc.get(n.id) ?? 0) === 0 || n.type === "startEvent")
    .map(n => n.id);

  const visited = new Set<string>();
  queue.forEach(id => rank.set(id, 0));

  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const r = rank.get(id) ?? 0;
    for (const tgt of out.get(id) ?? []) {
      rank.set(tgt, Math.max(rank.get(tgt) ?? 0, r + 1));
      if (!visited.has(tgt)) queue.push(tgt);
    }
  }
  // Any unvisited nodes
  for (const n of nodes) { if (!rank.has(n.id)) rank.set(n.id, 0); }

  // Group by column
  const cols = new Map<number, string[]>();
  for (const n of nodes) {
    const c = rank.get(n.id) ?? 0;
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c)!.push(n.id);
  }

  const result = new Map<string, LayoutElem>();
  for (const n of nodes) {
    const col = rank.get(n.id) ?? 0;
    const row = cols.get(col)?.indexOf(n.id) ?? 0;
    result.set(n.id, { ...n, col, row });
  }
  return result;
}

// ── Step 5: Generate bpmndi:BPMNDiagram XML ───────────────────────────────────
const COL_W  = 160;  // horizontal spacing
const ROW_H  = 110;  // vertical spacing
const OX     = 120;  // left margin
const OY     = 100;  // top margin

function injectDiagram(xml: string, processId: string, layout: Map<string, LayoutElem>, flows: Flow[]): string {
  const shapes = [...layout.values()].map(n => {
    const { w, h } = elSize(n.type);
    const x = OX + n.col * COL_W;
    const y = OY + n.row * ROW_H;
    return `      <bpmndi:BPMNShape id="Shape_${n.id}" bpmnElement="${n.id}">\n`
         + `        <dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" />\n`
         + `      </bpmndi:BPMNShape>`;
  }).join("\n");

  const edges = flows.map(f => {
    const s = layout.get(f.source);
    const t = layout.get(f.target);
    if (!s || !t) return "";
    const { w: sw, h: sh } = elSize(s.type);
    const { h: th } = elSize(t.type);
    const x1 = OX + s.col * COL_W + sw;
    const y1 = OY + s.row * ROW_H + sh / 2;
    const x2 = OX + t.col * COL_W;
    const y2 = OY + t.row * ROW_H + th / 2;
    const mx = Math.round((x1 + x2) / 2);
    const pts = y1 === y2
      ? `        <di:waypoint x="${x1}" y="${y1}" />\n        <di:waypoint x="${x2}" y="${y2}" />`
      : `        <di:waypoint x="${x1}" y="${y1}" />\n        <di:waypoint x="${mx}" y="${y1}" />\n        <di:waypoint x="${mx}" y="${y2}" />\n        <di:waypoint x="${x2}" y="${y2}" />`;
    return `      <bpmndi:BPMNEdge id="Edge_${f.id}" bpmnElement="${f.id}">\n${pts}\n      </bpmndi:BPMNEdge>`;
  }).filter(Boolean).join("\n");

  const block = `\n  <bpmndi:BPMNDiagram id="BPMNDiagram_1">\n`
              + `    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${processId}">\n`
              + shapes + "\n" + edges + "\n"
              + `    </bpmndi:BPMNPlane>\n  </bpmndi:BPMNDiagram>`;

  return xml
    .replace(/<\/bpmn:definitions>/, block + "\n</bpmn:definitions>")
    .replace(/<\/bpmn2:definitions>/, block + "\n</bpmn2:definitions>");
}

// ── Main preparation pipeline ─────────────────────────────────────────────────
function prepareXml(raw: string): string {
  const xml   = fixNamespaces(raw);
  const clean = stripDiagram(xml);
  const { processId, nodes, flows } = parseElements(clean);

  if (nodes.length === 0) return BLANK_DIAGRAM; // sin elementos → diagrama en blanco válido

  const layout = buildLayout(nodes, flows);
  return injectDiagram(clean, processId, layout, flows);
}

// ── React component: full BpmnModeler (editable) ──────────────────────────────
// Badge color fallbacks per overlay type
const OVERLAY_COLORS: Record<string, string> = {
  lean:      "#ef4444",
  six_sigma: "#8b5cf6",
  toc:       "#f97316",
  kpi:       "#3b82f6",
  risk:      "#eab308",
};

// Cache del viewport (zoom/scroll) por caseId, para que al volver al editor la
// vista NO se recentre/reescale (se percibía como "se movió todo el diagrama").
type Viewbox = { x: number; y: number; width: number; height: number };
const VIEWBOX_CACHE = new Map<string, Viewbox>();

interface BpmnViewerProps {
  xml: string;
  height?: number;
  /** Si se pasa, muestra botón "Guardar BPMN" que persiste + detecta sub-elementos. */
  caseId?: string;
  /** Callback cuando se guarda — útil para refrescar contexto AI / lista de hijos. */
  onSaved?: (result: SaveBpmnResponse) => void;
  /** Overlays analíticos a renderizar como capas sobre el diagrama (ADR-002). */
  overlays?: BpmnOverlay[];
  /** Callback con el XML exportado cada vez que el diagrama cambia (para persistir sin caseId). */
  onChange?: (xml: string) => void;
  /** Escenario (AS-IS / TO-BE) — lo usa el asistente IA de la simulación. */
  scenario?: "asis" | "tobe";
  /** Id del proceso — para persistir resultados de simulación por proceso/escenario. */
  processId?: string;
  /** Nombre del proceso — para títulos y export. */
  processName?: string;
}

export function BpmnViewer({ xml, height = 480, caseId, onSaved, overlays, onChange, scenario, processId, processName }: BpmnViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const modelerRef   = useRef<InstanceType<typeof BpmnModeler> | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [copied,  setCopied]  = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [modelerReady, setModelerReady] = useState(false);

  // Esc cierra fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  useEffect(() => {
    if (!containerRef.current || !xml) return;
    let cancelled = false;

    async function mount() {
      if (cancelled || !containerRef.current) return;
      setError(null);
      setModelerReady(false);
      setSimOpen(false);

      if (modelerRef.current) {
        try { modelerRef.current.destroy(); } catch { /* ok */ }
        modelerRef.current = null;
      }

      const modeler = new BpmnModeler({
        container: containerRef.current,
        keyboard: { bindTo: document },
        additionalModules: [
          minimapModule,
          bpmnColorPickerModule,
          fullPaletteModule,
        ],
      });
      modelerRef.current = modeler;

      // Activar el minimap automáticamente
      try {
        const mm = modeler.get("minimap") as { open?: () => void } | undefined;
        mm?.open?.();
      } catch { /* ok */ }

      try {
        let prepared: string;
        try { prepared = prepareXml(xml); } catch { prepared = BLANK_DIAGRAM; }
        try {
          await modeler.importXML(prepared);
        } catch (impErr) {
          // Recuperación: si el diagrama no se puede mostrar (XML vacío/ inválido),
          // abre uno en blanco editable en vez de bloquear el editor.
          console.warn("[BpmnViewer] import falló, abriendo diagrama en blanco:", impErr);
          await modeler.importXML(BLANK_DIAGRAM);
        }
        if (!cancelled) {
          setModelerReady(true);
          const canvas = modeler.get("canvas") as {
            zoom: (a: string, b?: string) => void;
            viewbox: (vb?: Viewbox) => Viewbox;
          };
          // Restaura el viewport previo (si volvimos a este caso); si no, encaja.
          const saved = caseId ? VIEWBOX_CACHE.get(caseId) : undefined;
          if (saved) {
            try { canvas.viewbox(saved); } catch { canvas.zoom("fit-viewport", "auto"); }
          } else {
            canvas.zoom("fit-viewport", "auto");
          }
          // Guarda el viewport cuando el usuario hace zoom/scroll.
          if (caseId) {
            const eb = modeler.get("eventBus") as { on: (e: string, fn: (ev: { viewbox?: Viewbox }) => void) => void };
            eb.on("canvas.viewbox.changed", (ev) => {
              if (!cancelled && ev?.viewbox) VIEWBOX_CACHE.set(caseId, ev.viewbox);
            });
          }
          // Emite el XML al editar (para persistir sin caseId). Debounced.
          {
            const eb = modeler.get("eventBus") as { on: (e: string, fn: () => void) => void };
            let t: ReturnType<typeof setTimeout> | null = null;
            eb.on("commandStack.changed", () => {
              if (cancelled || !onChangeRef.current) return;
              if (t) clearTimeout(t);
              t = setTimeout(async () => {
                try {
                  const { xml: out } = await modeler.saveXML({ format: true });
                  if (!cancelled && out) onChangeRef.current?.(out);
                } catch { /* ok */ }
              }, 500);
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          console.error("[BpmnViewer] error:", err);
        }
      }
    }

    const timer = setTimeout(() => {
      void mount();
      if (containerRef.current && "ResizeObserver" in window) {
        // Solo encaja al redimensionar si NO hay un viewport guardado para este
        // caso; si lo hay, respetamos el zoom/scroll del usuario (no recentrar).
        const ro = new ResizeObserver(() => {
          if (cancelled || !modelerRef.current) return;
          if (caseId && VIEWBOX_CACHE.has(caseId)) return;
          try { modelerRef.current.get("canvas").zoom("fit-viewport", "auto"); }
          catch { /* ok */ }
        });
        ro.observe(containerRef.current);
        (containerRef.current as HTMLDivElement & { _ro?: ResizeObserver })._ro = ro;
      }
    }, 60);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      const el = containerRef.current as (HTMLDivElement & { _ro?: ResizeObserver }) | null;
      if (el?._ro) el._ro.disconnect();
      if (modelerRef.current) {
        try { modelerRef.current.destroy(); } catch { /* ok */ }
        modelerRef.current = null;
      }
    };
  }, [xml]);

  // Re-render overlays whenever the overlay list or the modeler changes
  useEffect(() => {
    if (!modelerRef.current || !overlays?.length) return;

    // Wait until bpmn-js has finished importing (eventBus fires "import.done")
    const modeler = modelerRef.current;
    let applied = false;

    function applyOverlays() {
      if (applied) return;
      applied = true;
      try {
        const overlaysSvc = modeler.get("overlays") as {
          add: (elementId: string, type: string, config: unknown) => string;
          clear: () => void;
        };
        overlaysSvc.clear();

        for (const ov of overlays ?? []) {
          const color = ov.visual?.badge_color ?? OVERLAY_COLORS[ov.overlay_type] ?? "#6b7280";
          const icon  = ov.visual?.icon ?? "";
          const tip   = ov.visual?.tooltip ?? ov.overlay_type;

          const html = document.createElement("div");
          html.title = tip;
          html.style.cssText = [
            `background:${color}`,
            "color:#fff",
            "border-radius:4px",
            "padding:2px 5px",
            "font-size:11px",
            "font-weight:600",
            "white-space:nowrap",
            "cursor:default",
            "box-shadow:0 1px 3px rgba(0,0,0,.3)",
            "pointer-events:auto",
          ].join(";");
          html.textContent = `${icon} ${ov.overlay_type}`.trim();

          try {
            overlaysSvc.add(ov.element_id, `overlay-${ov.overlay_type}`, {
              position: { top: -22, right: 0 },
              html,
            });
          } catch {
            // element not found in current diagram — skip silently
          }
        }
      } catch {
        // overlays service not available yet
      }
    }

    try {
      const eventBus = modeler.get("eventBus") as {
        on: (event: string, fn: () => void) => void;
      };
      eventBus.on("import.done", applyOverlays);
      // Also try immediately in case import already completed
      applyOverlays();
    } catch {
      applyOverlays();
    }
  }, [overlays, xml]);

  async function handleCopyXml() {
    if (!modelerRef.current) return;
    try {
      const { xml: exported } = await modelerRef.current.saveXML({ format: true });
      await navigator.clipboard.writeText(exported);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard may be blocked */ }
  }

  function triggerDownload(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportBpmn() {
    if (!modelerRef.current) return;
    try {
      const { xml: exported } = await modelerRef.current.saveXML({ format: true });
      triggerDownload(`diagram-${Date.now()}.bpmn`, exported, "application/xml");
    } catch (e) { console.error("[export bpmn]", e); }
  }

  async function handleExportSvg() {
    if (!modelerRef.current) return;
    try {
      const { svg } = await modelerRef.current.saveSVG();
      triggerDownload(`diagram-${Date.now()}.svg`, svg, "image/svg+xml");
    } catch (e) { console.error("[export svg]", e); }
  }

  function handleImportXml() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".bpmn,.xml,application/xml,text/xml";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f || !modelerRef.current) return;
      try {
        const text = await f.text();
        // Pasa por el preparador (reconstruye el diagrama/DI si falta) y, si aun
        // así falla, abre en blanco — nunca deja el editor en estado de error.
        try {
          await modelerRef.current.importXML(prepareXml(text));
        } catch (impErr) {
          console.warn("[import xml] reintento en blanco:", impErr);
          await modelerRef.current.importXML(BLANK_DIAGRAM);
        }
        modelerRef.current.get("canvas").zoom("fit-viewport", "auto");
        setError(null);
      } catch (e) {
        console.error("[import xml]", e);
        setError(`Error al importar: ${e}`);
      }
    };
    inp.click();
  }

  async function handleNewDiagram() {
    if (!modelerRef.current) return;
    if (!confirm("¿Iniciar un diagrama nuevo en blanco? Se perderán los cambios sin guardar.")) return;
    const blank = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="${NS_BPMN}" xmlns:bpmndi="${NS_BPMNDI}" xmlns:dc="${NS_DC}" xmlns:di="${NS_DI}" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="180" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    try {
      await modelerRef.current.importXML(blank);
      modelerRef.current.get("canvas").zoom("fit-viewport", "auto");
    } catch (e) {
      console.error("[new diagram]", e);
    }
  }


  // Guardado manual para el modo AS-IS / TO-BE (persiste vía onChange).
  async function handleManualSave() {
    if (!modelerRef.current || saving) return;
    setSaving(true); setSaveMsg(null);
    try {
      const { xml: exported } = await modelerRef.current.saveXML({ format: true });
      if (exported) onChangeRef.current?.(exported);
      setSaveMsg("Guardado ✓");
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e) {
      setSaveMsg(`Error: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!modelerRef.current || !caseId || saving) return;
    setSaving(true); setSaveMsg(null);
    try {
      const { xml: exported } = await modelerRef.current.saveXML({ format: true });
      const result = await saveBpmn(caseId, exported, true);
      const c = result.detection.created.length;
      const s = result.detection.skipped_existing;
      const parts: string[] = ["Guardado ✓"];
      if (c > 0) {
        const byLevel = result.detection.classification ?? [];
        const breakdown = byLevel
          .map((g) => `${g.count} ${g.level_name} (N${g.level})`)
          .join(", ");
        parts.push(breakdown ? `${c} clasificado(s): ${breakdown}` : `${c} sub-elemento(s) creado(s)`);
      }
      if (s > 0) parts.push(`${s} ya existía(n)`);
      setSaveMsg(parts.join(" · "));
      setTimeout(() => setSaveMsg(null), 6000);
      onSaved?.(result);
    } catch (e) {
      setSaveMsg(`Error: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  function handleZoom(delta: number) {
    if (!modelerRef.current) return;
    try {
      const canvas = modelerRef.current.get("canvas");
      canvas.zoom((canvas.zoom("") as unknown as number) + delta);
    } catch { /* ok */ }
  }

  function handleFit() {
    try { modelerRef.current?.get("canvas").zoom("fit-viewport", "auto"); }
    catch { /* ok */ }
  }

  if (error) {
    return (
      <div style={{ padding: "12px", color: "var(--clay)", fontSize: "0.82rem",
                    background: "rgba(185,79,61,.06)", borderRadius: "6px",
                    fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
        {error}
      </div>
    );
  }

  return (
    <div className={`bpmn-editor-wrap ${fullscreen ? "bpmn-editor-fullscreen" : ""}`}>
      {/* Toolbar */}
      <div className="bpmn-toolbar">
        {/* Grupo: archivo */}
        <button className="bpmn-tb-btn" type="button" title="Nuevo diagrama en blanco" onClick={() => void handleNewDiagram()}>
          <FilePlus size={14} />
        </button>
        <button className="bpmn-tb-btn" type="button" title="Importar archivo .bpmn / .xml" onClick={handleImportXml}>
          <FileUp size={14} />
        </button>
        <button className="bpmn-tb-btn" type="button" title="Descargar como .bpmn" onClick={() => void handleExportBpmn()}>
          <FileDown size={14} />
        </button>
        <button className="bpmn-tb-btn" type="button" title="Descargar como SVG" onClick={() => void handleExportSvg()}>
          <Download size={14} />
        </button>
        <span className="bpmn-tb-sep" />
        {/* Grupo: edición */}
        <button className="bpmn-tb-btn" type="button" title="Deshacer (Ctrl+Z)"
          onClick={() => { try { modelerRef.current?.get("commandStack").undo(); } catch { /* ok */ } }}>
          <Undo2 size={14} />
        </button>
        <button className="bpmn-tb-btn" type="button" title="Rehacer (Ctrl+Y)"
          onClick={() => { try { modelerRef.current?.get("commandStack").redo(); } catch { /* ok */ } }}>
          <Redo2 size={14} />
        </button>
        <span className="bpmn-tb-sep" />
        {/* Grupo: vista */}
        <button className="bpmn-tb-btn" type="button" title="Acercar" onClick={() => handleZoom(0.2)}>
          <Plus size={14} />
        </button>
        <button className="bpmn-tb-btn" type="button" title="Alejar" onClick={() => handleZoom(-0.2)}>
          <Minus size={14} />
        </button>
        <button className="bpmn-tb-btn" type="button" title="Ajustar vista" onClick={handleFit}>
          <Maximize2 size={14} />
        </button>
        <span className="bpmn-tb-sep" />
        {/* Grupo: simulación */}
        <button
          className={`bpmn-tb-btn bpmn-tb-btn-sim ${simOpen ? "active" : ""}`}
          type="button"
          title="Simulación de procesos (animar tokens, KPIs de cycle time / espera / recursos)"
          onClick={() => setSimOpen((s) => !s)}
          disabled={!modelerReady}
        >
          <Zap size={14} />
          <span style={{ marginLeft: 4 }}>{simOpen ? "Cerrar sim" : "Simular"}</span>
        </button>
        <span className="bpmn-tb-sep" />
        {/* Grupo: clipboard + save */}
        <button className="bpmn-tb-btn" type="button" title="Copiar XML al portapapeles" onClick={handleCopyXml}>
          <Copy size={14} />
          <span style={{ marginLeft: 4 }}>{copied ? "¡Copiado!" : "XML"}</span>
        </button>
        {caseId ? (
          <button
            className="bpmn-tb-btn bpmn-tb-btn-primary"
            type="button"
            title="Guardar BPMN y crear automáticamente los sub-procesos / procedimientos / instructivos detectados"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            <span style={{ marginLeft: 4 }}>{saving ? "Guardando…" : "Guardar BPMN"}</span>
          </button>
        ) : onChange ? (
          <button
            className="bpmn-tb-btn bpmn-tb-btn-primary"
            type="button"
            title="Guardar el diagrama"
            onClick={() => void handleManualSave()}
            disabled={saving}
          >
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            <span style={{ marginLeft: 4 }}>{saving ? "Guardando…" : "Guardar diagrama"}</span>
          </button>
        ) : null}
        {saveMsg && (
          <span style={{ marginLeft: 8, fontSize: ".78rem", color: saveMsg.startsWith("Error") ? "var(--clay)" : "var(--green)" }}>
            {saveMsg}
          </span>
        )}
        <button
          className="bpmn-tb-btn"
          type="button"
          title={fullscreen ? "Salir de pantalla completa (Esc)" : "Pantalla completa"}
          onClick={() => setFullscreen((f) => !f)}
          style={{ marginLeft: "auto" }}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Canvas + (opcional) sidebar de propiedades */}
      <div className="bpmn-canvas-row">
        <div
          ref={containerRef}
          className="bpmn-canvas-area"
          style={{
            height: fullscreen ? "calc(100vh - 50px)" : `${height}px`,
            background: "#fafafa",
            overflow: "hidden",
          }}
        />
        {simOpen && modelerReady && modelerRef.current && (
          <div
            className="bpmn-sim-dock"
            style={{ height: fullscreen ? "calc(100vh - 50px)" : `${height}px` }}
          >
            <SimulationPanel modeler={modelerRef.current} onClose={() => setSimOpen(false)} scenario={scenario} processId={processId} processName={processName} />
          </div>
        )}
      </div>
    </div>
  );
}
