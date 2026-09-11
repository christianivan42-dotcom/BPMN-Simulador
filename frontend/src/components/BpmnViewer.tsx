import BpmnModeler from "bpmn-js/lib/Modeler";
import bpmnColorPickerModule from "bpmn-js-color-picker";
import minimapModule from "diagram-js-minimap";
import fullPaletteModule from "../bpmn/fullPaletteModule";
import { Copy, Download, FileDown, FileUp, FilePlus, Loader2, Maximize2, Minimize2, Minus, Plus, Redo2, Save, Undo2, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BpmnOverlay } from "../api";
import type { SaveOutcome } from "../lib/storage";
import { SimulationPanel } from "./procesos/SimulationPanel";
import {
  BLANK_DIAGRAM,
  NS_BPMN,
  NS_BPMNDI,
  NS_DC,
  NS_DI,
  prepareXml,
} from "../bpmn/prepareXml";

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
  /** Clave para recordar el zoom/scroll al volver a este diagrama. */
  viewportKey?: string;
  /** Overlays analíticos a renderizar como capas sobre el diagrama (ADR-002). */
  overlays?: BpmnOverlay[];
  /** Persiste el XML exportado cada vez que el diagrama cambia.
   *  Devuelve el resultado para que el editor avise si el guardado falló. */
  onChange?: (xml: string) => void | SaveOutcome | Promise<void | SaveOutcome>;
  /** Escenario (AS-IS / TO-BE) — lo usa el asistente IA de la simulación. */
  scenario?: "asis" | "tobe";
  /** Id del proceso — para persistir resultados de simulación por proceso/escenario. */
  processId?: string;
  /** Nombre del proceso — para títulos y export. */
  processName?: string;
}

export function BpmnViewer({ xml, height = 480, viewportKey, overlays, onChange, scenario, processId, processName }: BpmnViewerProps) {
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
          const saved = viewportKey ? VIEWBOX_CACHE.get(viewportKey) : undefined;
          if (saved) {
            try { canvas.viewbox(saved); } catch { canvas.zoom("fit-viewport", "auto"); }
          } else {
            canvas.zoom("fit-viewport", "auto");
          }
          // Guarda el viewport cuando el usuario hace zoom/scroll.
          if (viewportKey) {
            const eb = modeler.get("eventBus") as { on: (e: string, fn: (ev: { viewbox?: Viewbox }) => void) => void };
            eb.on("canvas.viewbox.changed", (ev) => {
              if (!cancelled && ev?.viewbox) VIEWBOX_CACHE.set(viewportKey, ev.viewbox);
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
                  if (!cancelled && out) await onChangeRef.current?.(out);
                } catch { /* el propio onChange reporta sus fallos */ }
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
          if (viewportKey && VIEWBOX_CACHE.has(viewportKey)) return;
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

  /** Exporta el diagrama actual y lo manda a persistir.
   *
   *  `importXML` reinicia el commandStack SIN emitir "commandStack.changed", así
   *  que el autoguardado no se enteraba: se importaba un .bpmn, se veía en
   *  pantalla y no se guardaba en ninguna parte. Tras importar o empezar de cero
   *  hay que persistir explícitamente. */
  async function persistCurrent(): Promise<void> {
    if (!modelerRef.current || !onChangeRef.current) return;
    try {
      const { xml: exported } = await modelerRef.current.saveXML({ format: true });
      if (exported) await onChangeRef.current(exported);
    } catch (e) {
      console.error("[persistCurrent]", e);
    }
  }

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
    // Firefox exige que el <a> esté en el documento para respetar `download`.
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    // Revocar en el mismo tick cancelaba la descarga en algunos navegadores.
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
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
        await persistCurrent();
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
      await persistCurrent();
    } catch (e) {
      console.error("[new diagram]", e);
    }
  }


  // Guardado manual del escenario activo (persiste vía onChange → backend).
  async function handleManualSave() {
    if (!modelerRef.current || saving) return;
    setSaving(true); setSaveMsg(null);
    try {
      const { xml: exported } = await modelerRef.current.saveXML({ format: true });
      const result = exported ? await onChangeRef.current?.(exported) : undefined;
      // Si quien persiste informa de un fallo, NO se anuncia éxito: el diagrama
      // no está guardado y el usuario tiene que enterarse.
      if (result && result.ok === false) {
        setSaveMsg("Error: no se pudo guardar (ver aviso arriba)");
        setTimeout(() => setSaveMsg(null), 8000);
      } else {
        setSaveMsg("Guardado ✓");
        setTimeout(() => setSaveMsg(null), 3000);
      }
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
        <button className="bpmn-tb-btn" type="button" title="Descargar como .bpmn (copia de seguridad fuera del navegador)" onClick={() => void handleExportBpmn()}>
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
        {onChange && (
          <button
            className="bpmn-tb-btn bpmn-tb-btn-primary"
            type="button"
            title="Guardar el diagrama en el servidor"
            onClick={() => void handleManualSave()}
            disabled={saving}
          >
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            <span style={{ marginLeft: 4 }}>{saving ? "Guardando…" : "Guardar diagrama"}</span>
          </button>
        )}
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
