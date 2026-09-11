// ── Animador de tokens sobre el canvas de bpmn-js ────────────────────────────
// Reproduce la línea de tiempo (segmentos) del motor: dibuja círculos SVG que
// recorren los flujos por sus waypoints y permanecen en las tareas mientras se
// procesan. Controla reloj de simulación, velocidad, play/pausa/reset/seek.

import { pointAlong, type SimGraph } from "./simGraph";
import type { Segment } from "./simEngine";

const SVG_NS = "http://www.w3.org/2000/svg";

interface Canvas {
  getLayer: (name: string, index?: number) => SVGElement;
  addMarker: (id: string, cls: string) => void;
  removeMarker: (id: string, cls: string) => void;
}
interface Modeler {
  get: (name: string) => unknown;
}

function caseColor(caseId: number): string {
  const hue = (caseId * 47) % 360;
  return `hsl(${hue}, 85%, 50%)`;
}

export interface AnimatorTick {
  time: number;
  liveTokens: number;
  progress: number; // 0..1
  playing: boolean;
}

export class TokenAnimator {
  private canvas: Canvas;
  private graph: SimGraph;
  private layer: SVGElement;
  private segments: Segment[] = [];
  private maxTime = 0;

  private clock = 0;
  private speed = 30; // minutos de simulación por segundo real
  private playing = false;
  private raf: number | null = null;
  private lastWall = 0;
  private nextIdx = 0;
  private live: Segment[] = [];
  private dots = new Map<string, SVGCircleElement>();
  private activeMarkers = new Set<string>();
  private tickCb: ((t: AnimatorTick) => void) | null = null;

  constructor(modeler: Modeler, graph: SimGraph) {
    this.canvas = modeler.get("canvas") as Canvas;
    this.graph = graph;
    this.layer = this.canvas.getLayer("sim-tokens", 600);
  }

  load(segments: Segment[], maxTime: number) {
    this.reset();
    this.segments = segments;
    this.maxTime = maxTime || 1;
  }

  onTick(cb: (t: AnimatorTick) => void) {
    this.tickCb = cb;
  }

  setSpeed(simMinPerSec: number) {
    this.speed = Math.max(0.5, simMinPerSec);
  }

  get isPlaying() {
    return this.playing;
  }
  get time() {
    return this.clock;
  }

  play() {
    if (this.playing) return;
    if (this.clock >= this.maxTime) this.seek(0);
    this.playing = true;
    this.lastWall = performance.now();
    this.loop();
  }

  pause() {
    this.playing = false;
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.emit();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(t: number) {
    const target = Math.max(0, Math.min(t, this.maxTime));
    // si retrocedemos, reconstruir desde cero
    if (target < this.clock) {
      this.nextIdx = 0;
      this.live = [];
      this.clearDots();
      this.clearMarkers();
    }
    this.clock = target;
    this.render();
    this.emit();
  }

  reset() {
    this.pause();
    this.clock = 0;
    this.nextIdx = 0;
    this.live = [];
    this.clearDots();
    this.clearMarkers();
    this.emit();
  }

  destroy() {
    this.pause();
    this.clearDots();
    this.clearMarkers();
    try {
      while (this.layer.firstChild) this.layer.removeChild(this.layer.firstChild);
    } catch {
      /* ok */
    }
  }

  // ── interno ────────────────────────────────────────────────────────────────
  private loop = () => {
    if (!this.playing) return;
    const now = performance.now();
    const dt = (now - this.lastWall) / 1000;
    this.lastWall = now;
    this.clock += dt * this.speed;
    if (this.clock >= this.maxTime) {
      this.clock = this.maxTime;
      this.render();
      this.pause();
      return;
    }
    this.render();
    this.emit();
    this.raf = requestAnimationFrame(this.loop);
  };

  private render() {
    const t = this.clock;
    // incorpora segmentos que ya comenzaron
    while (this.nextIdx < this.segments.length && this.segments[this.nextIdx].tStart <= t) {
      this.live.push(this.segments[this.nextIdx]);
      this.nextIdx++;
    }
    // descarta los que terminaron
    this.live = this.live.filter((s) => s.tEnd > t);

    const seenTokens = new Set<string>();
    const seenActive = new Set<string>();

    for (const seg of this.live) {
      if (seg.tStart > t) continue;
      seenTokens.add(seg.tokenId);
      const pos = this.positionOf(seg, t);
      if (!pos) continue;
      this.placeDot(seg.tokenId, pos.x, pos.y, seg.caseId);
      if (seg.kind === "node" && seg.active) {
        seenActive.add(seg.refId);
      }
    }

    // limpia dots cuyo token ya no está vivo
    for (const [tokenId, el] of this.dots) {
      if (!seenTokens.has(tokenId)) {
        el.remove();
        this.dots.delete(tokenId);
      }
    }
    // marcadores de tareas activas
    for (const id of this.activeMarkers) {
      if (!seenActive.has(id)) {
        try {
          this.canvas.removeMarker(id, "sim-active");
        } catch {
          /* ok */
        }
        this.activeMarkers.delete(id);
      }
    }
    for (const id of seenActive) {
      if (!this.activeMarkers.has(id)) {
        try {
          this.canvas.addMarker(id, "sim-active");
        } catch {
          /* ok */
        }
        this.activeMarkers.add(id);
      }
    }
  }

  private positionOf(seg: Segment, t: number): { x: number; y: number } | null {
    if (seg.kind === "flow") {
      const flow = this.graph.flows.get(seg.refId);
      if (!flow) return null;
      const span = seg.tEnd - seg.tStart || 1;
      const frac = (t - seg.tStart) / span;
      return pointAlong(flow, frac);
    }
    const node = this.graph.nodes.get(seg.refId);
    if (!node) return null;
    return { x: node.cx, y: node.cy };
  }

  private placeDot(tokenId: string, x: number, y: number, caseId: number) {
    let el = this.dots.get(tokenId);
    if (!el) {
      el = document.createElementNS(SVG_NS, "circle") as SVGCircleElement;
      el.setAttribute("r", "8");
      el.setAttribute("fill", caseColor(caseId));
      el.setAttribute("stroke", "#ffffff");
      el.setAttribute("stroke-width", "2");
      el.setAttribute("class", "sim-token-dot");
      el.style.filter = "drop-shadow(0 1px 2px rgba(0,0,0,.35))";
      this.layer.appendChild(el);
      this.dots.set(tokenId, el);
    }
    el.setAttribute("cx", String(x));
    el.setAttribute("cy", String(y));
  }

  private clearDots() {
    for (const el of this.dots.values()) el.remove();
    this.dots.clear();
  }
  private clearMarkers() {
    for (const id of this.activeMarkers) {
      try {
        this.canvas.removeMarker(id, "sim-active");
      } catch {
        /* ok */
      }
    }
    this.activeMarkers.clear();
  }

  private emit() {
    this.tickCb?.({
      time: this.clock,
      liveTokens: this.dots.size,
      progress: this.maxTime > 0 ? this.clock / this.maxTime : 0,
      playing: this.playing,
    });
  }
}
