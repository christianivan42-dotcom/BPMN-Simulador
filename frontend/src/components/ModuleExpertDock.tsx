/**
 * ModuleExpertDock — AI experto por módulo.
 *
 * A diferencia del ContextualAiDock (que se contextualiza al nodo BPM activo),
 * este dock se contextualiza al MÓDULO activo y actúa como un consultor experto
 * en ese dominio. Cada módulo inyecta:
 *   - role: rol/experiencia del experto
 *   - intro: mensaje de bienvenida
 *   - suggestions: chips de preguntas iniciales útiles
 *   - systemContext: contexto extra (ej. lista de casos, KPIs)
 *
 * Persiste el historial por módulo en localStorage.
 */
import {
  Brain,
  Loader2,
  PlusCircle,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { expertAsk } from "../api";
import { ChatMarkdown } from "./ChatMarkdown";
import type { Module } from "../modules";

// ── Module expertise definitions ────────────────────────────────────────────

export type ExpertConfig = {
  role: string;
  intro: string;
  suggestions: string[];
};

const EXPERTS: Record<Module, ExpertConfig> = {
  inicio: {
    role: "consultor senior en planificación estratégica y BPM corporativo (misión, visión, valores, objetivos estratégicos, KPIs y POA)",
    intro:
      "Soy tu consultor de estrategia y procesos. Puedo ayudarte a definir misión/visión/valores, " +
      "traducir la estrategia en objetivos y KPIs, y alinear el POA con el mapa de procesos.",
    suggestions: [
      "Ayúdame a redactar la misión y visión de mi organización",
      "¿Cómo derivo KPIs desde mis objetivos estratégicos?",
      "Relaciona mi POA con los procesos clave",
      "¿Qué objetivos estratégicos debería priorizar este año?",
    ],
  },
  procesos: {
    role: "experto en arquitectura empresarial, mapa de procesos (Porter/APQC) y modelado BPMN 2.0 (AS-IS / TO-BE)",
    intro:
      "Soy especialista en arquitectura de procesos. Con base en el contexto de tu organización puedo " +
      "diseñar tu mapa de procesos y ayudarte a modelar el BPMN AS-IS y TO-BE.",
    suggestions: [
      "Diseña el mapa de procesos a partir de mi estrategia",
      "¿Qué macroprocesos son estratégicos, operativos y de soporte?",
      "¿Cuándo usar gateway exclusivo vs paralelo en BPMN?",
      "Buenas prácticas para nombrar y codificar procesos",
    ],
  },
  conocimiento: {
    role: "experto en gestión del conocimiento organizacional y knowledge graphs aplicados a BPM",
    intro:
      "Soy especialista en gestión del conocimiento. Puedo ayudarte a leer el mapa de conocimiento " +
      "de los nodos y conectar procesos, documentos y decisiones.",
    suggestions: [
      "¿Cómo interpreto el mapa de conocimiento de los nodos?",
      "Knowledge graph: nodos y relaciones útiles en BPM",
      "¿Qué nodos están más conectados y por qué importa?",
      "Cómo enriquecer el conocimiento de un proceso",
    ],
  },
};

// ── Types & helpers ─────────────────────────────────────────────────────────

type Exchange = {
  id: string;
  query: string;
  answer: string | null;
  provider: string | null;
  model: string | null;
  loading: boolean;
  error: string | null;
};

function historyKey(mod: Module) {
  return `expert_dock_history_${mod}`;
}

// ── Component ───────────────────────────────────────────────────────────────

type Props = {
  activeModule: Module;
};

export function ModuleExpertDock({ activeModule }: Props) {
  const expert = EXPERTS[activeModule];

  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load history when activeModule changes
  useEffect(() => {
    try {
      const raw = localStorage.getItem(historyKey(activeModule));
      setHistory(raw ? (JSON.parse(raw) as Exchange[]) : []);
    } catch { setHistory([]); }
    setErr(null);
    setConfirmClear(false);
  }, [activeModule]);

  // Persist history
  useEffect(() => {
    try {
      localStorage.setItem(
        historyKey(activeModule),
        JSON.stringify(history.filter((h) => !h.loading).slice(-30)),
      );
    } catch { /* ignore */ }
  }, [history, activeModule]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, loading]);

  async function send(overrideQuery?: string) {
    const q = (overrideQuery ?? input).trim();
    if (!q || loading) return;

    const exchangeId = `ex_${Date.now()}`;
    const newExchange: Exchange = {
      id: exchangeId, query: q, answer: null, provider: null, model: null, loading: true, error: null,
    };

    setHistory((h) => [...h, newExchange]);
    setInput("");
    setLoading(true);
    setErr(null);

    try {
      // Send recent history as conversation context (max 6 turns)
      const recentHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
      for (const ex of history.slice(-6).filter((e) => !e.loading && e.answer)) {
        recentHistory.push({ role: "user", content: ex.query });
        recentHistory.push({ role: "assistant", content: ex.answer ?? "" });
      }

      const res = await expertAsk({
        query: q,
        role: `Eres ${expert.role}.`,
        history: recentHistory,
      });

      setHistory((h) =>
        h.map((ex) => ex.id === exchangeId
          ? {
              ...ex,
              answer: res.answer,
              provider: res.provider,
              model: res.model,
              loading: false,
              error: res.success ? null : (res.error ?? "Sin respuesta"),
            }
          : ex,
        ),
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setErr(errMsg);
      setHistory((h) =>
        h.map((ex) => ex.id === exchangeId
          ? { ...ex, error: errMsg, loading: false }
          : ex,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  function clearHistory() {
    try { localStorage.removeItem(historyKey(activeModule)); } catch { /* ignore */ }
    setHistory([]);
    setConfirmClear(false);
    setErr(null);
  }

  const hasHistory = history.length > 0;

  return (
    <aside className="ai-dock-v2">
      <header className="ai-dock-v2-header">
        <div className="ai-dock-v2-header-left">
          <Brain size={15} />
          <div>
            <strong>Experto · {activeModule}</strong>
            <p className="ai-dock-v2-subtitle">{expert.role.slice(0, 64)}…</p>
          </div>
        </div>
        <div className="ai-dock-v2-header-actions">
          <button
            type="button"
            className="ai-dock-icon-btn"
            onClick={() => setConfirmClear(true)}
            title="Nueva conversación"
            disabled={!hasHistory}
          >
            <PlusCircle size={13} />
          </button>
        </div>
      </header>

      {confirmClear && (
        <div className="ai-dock-confirm-bar">
          <span>¿Borrar conversación?</span>
          <button type="button" className="ai-dock-confirm-yes" onClick={clearHistory}>Sí, borrar</button>
          <button type="button" className="ai-dock-confirm-no" onClick={() => setConfirmClear(false)}>Cancelar</button>
        </div>
      )}

      <div className="ai-dock-v2-body">
        <div className="ai-dock-v2-main">
          {!hasHistory && (
            <div className="ai-dock-empty">
              <Sparkles size={22} style={{ color: "var(--teal)", opacity: 0.8 }} />
              <p className="ai-dock-empty-title">¿En qué puedo ayudarte?</p>
              <p className="ai-dock-empty-sub muted">{expert.intro}</p>

              <div className="ai-dock-suggestion-groups">
                <div className="ai-dock-suggestion-group">
                  <p className="ai-dock-suggestion-group-label" style={{ color: "var(--teal)" }}>
                    Preguntas frecuentes
                  </p>
                  {expert.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="ai-dock-suggestion-chip"
                      onClick={() => setInput(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {history.map((ex) => (
            <div key={ex.id} className="ai-dock-exchange-v2">
              <div className="ai-dock-user-bubble">{ex.query}</div>

              {ex.loading && (
                <div className="ai-dock-ai-bubble ai-dock-loading-bubble">
                  <Loader2 size={12} className="spin" />
                  <span>Consultando al experto…</span>
                </div>
              )}

              {ex.error && !ex.loading && (
                <div className="ai-dock-error-bubble">
                  <span>⚠ {ex.error}</span>
                  <button
                    type="button"
                    className="ai-dock-retry-btn"
                    onClick={() => void send(ex.query)}
                  >
                    <RefreshCw size={11} /> Reintentar
                  </button>
                </div>
              )}

              {ex.answer && !ex.loading && !ex.error && (
                <div className="ai-dock-ai-bubble">
                  <div className="ai-dock-response-content">
                    <ChatMarkdown content={ex.answer} />
                  </div>
                  {(ex.provider || ex.model) && (
                    <div className="ai-dock-meta-bar">
                      <span className="ai-dock-meta-chip" title="Proveedor LLM">
                        ⚡ {ex.provider}
                      </span>
                      {ex.model && (
                        <span className="ai-dock-meta-chip" title="Modelo">
                          🧠 {ex.model.slice(0, 32)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {err && !loading && (
            <p className="form-error" style={{ fontSize: "0.78rem", margin: "8px 0" }}>{err}</p>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <footer className="ai-dock-v2-footer">
        <textarea
          ref={textareaRef}
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Pregúntale al experto en ${activeModule}…`}
          disabled={loading}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="ai-dock-send-btn"
          disabled={loading || !input.trim()}
          onClick={() => void send()}
        >
          {loading ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
        </button>
      </footer>
    </aside>
  );
}
