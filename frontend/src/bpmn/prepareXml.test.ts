// Tests de la preparación del XML y del auto-layout.
//
// El editor recalcula la disposición de cualquier BPMN que se importe. Antes las
// flechas se cruzaban entre sí y los bucles de retrabajo pasaban por encima de
// las cajas; estos tests comprueban la geometría resultante.

import { describe, expect, it } from "vitest";
import { buildLayout, parseElements, prepareXml, type Elem, type Flow } from "./prepareXml";

// ── Utilidades para leer la DI generada ─────────────────────────────────────

interface Rect { id: string; x: number; y: number; w: number; h: number }
interface Edge { id: string; points: Array<{ x: number; y: number }> }

function shapesOf(xml: string): Rect[] {
  const out: Rect[] = [];
  const re = /<bpmndi:BPMNShape id="Shape_([^"]+)"[^>]*>\s*<dc:Bounds x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({ id: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] });
  }
  return out;
}

function edgesOf(xml: string): Edge[] {
  const out: Edge[] = [];
  const re = /<bpmndi:BPMNEdge id="Edge_([^"]+)"[^>]*>([\s\S]*?)<\/bpmndi:BPMNEdge>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const points: Array<{ x: number; y: number }> = [];
    const pre = /<di:waypoint x="(-?\d+)" y="(-?\d+)"/g;
    let p: RegExpExecArray | null;
    while ((p = pre.exec(m[2])) !== null) points.push({ x: +p[1], y: +p[2] });
    out.push({ id: m[1], points });
  }
  return out;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** ¿El segmento (recto, horizontal o vertical) atraviesa el rectángulo? */
function segmentCrossesRect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  r: Rect,
  margin = 4,
): boolean {
  const left = r.x + margin;
  const right = r.x + r.w - margin;
  const top = r.y + margin;
  const bottom = r.y + r.h - margin;
  if (p1.y === p2.y) {
    const [lo, hi] = [Math.min(p1.x, p2.x), Math.max(p1.x, p2.x)];
    return p1.y > top && p1.y < bottom && lo < right && hi > left;
  }
  if (p1.x === p2.x) {
    const [lo, hi] = [Math.min(p1.y, p2.y), Math.max(p1.y, p2.y)];
    return p1.x > left && p1.x < right && lo < bottom && hi > top;
  }
  return false;
}

// ── Proceso de ejemplo con bucle de retrabajo y compuertas ──────────────────

const PROCESO_CON_BUCLE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P1" isExecutable="false">
    <bpmn:startEvent id="Inicio" />
    <bpmn:userTask id="Registrar" />
    <bpmn:userTask id="Verificar" />
    <bpmn:exclusiveGateway id="Completa" />
    <bpmn:userTask id="PedirDocs" />
    <bpmn:userTask id="Evaluar" />
    <bpmn:exclusiveGateway id="Aprobado" />
    <bpmn:userTask id="Desembolsar" />
    <bpmn:endEvent id="Otorgado" />
    <bpmn:endEvent id="Rechazado" />
    <bpmn:sequenceFlow id="f1" sourceRef="Inicio" targetRef="Registrar" />
    <bpmn:sequenceFlow id="f2" sourceRef="Registrar" targetRef="Verificar" />
    <bpmn:sequenceFlow id="f3" sourceRef="Verificar" targetRef="Completa" />
    <bpmn:sequenceFlow id="f4" sourceRef="Completa" targetRef="PedirDocs" />
    <bpmn:sequenceFlow id="f5" sourceRef="PedirDocs" targetRef="Verificar" />
    <bpmn:sequenceFlow id="f6" sourceRef="Completa" targetRef="Evaluar" />
    <bpmn:sequenceFlow id="f7" sourceRef="Evaluar" targetRef="Aprobado" />
    <bpmn:sequenceFlow id="f8" sourceRef="Aprobado" targetRef="Desembolsar" />
    <bpmn:sequenceFlow id="f9" sourceRef="Aprobado" targetRef="Rechazado" />
    <bpmn:sequenceFlow id="f10" sourceRef="Desembolsar" targetRef="Otorgado" />
  </bpmn:process>
</bpmn:definitions>`;

describe("prepareXml", () => {
  it("genera diagrama para un BPMN sin coordenadas", () => {
    const xml = prepareXml(PROCESO_CON_BUCLE);

    expect(xml).toContain("<bpmndi:BPMNDiagram");
    expect(shapesOf(xml)).toHaveLength(10);
    expect(edgesOf(xml)).toHaveLength(10);
  });

  it("acepta BPMN sin prefijo de espacio de nombres", () => {
    const sinPrefijo = `<?xml version="1.0"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D">
  <process id="P1">
    <startEvent id="S" />
    <task id="T" />
    <endEvent id="E" />
    <sequenceFlow id="f1" sourceRef="S" targetRef="T" />
    <sequenceFlow id="f2" sourceRef="T" targetRef="E" />
  </process>
</definitions>`;

    const xml = prepareXml(sinPrefijo);

    expect(xml).toContain("bpmn:definitions");
    expect(shapesOf(xml)).toHaveLength(3);
  });

  it("devuelve un diagrama en blanco si no hay elementos reconocibles", () => {
    expect(prepareXml("<vacio/>")).toContain("StartEvent_1");
  });
});

describe("auto-layout: colocación", () => {
  const xml = prepareXml(PROCESO_CON_BUCLE);
  const shapes = shapesOf(xml);
  const at = (id: string) => shapes.find((s) => s.id === id)!;

  it("no solapa ningún par de elementos", () => {
    const solapes: string[] = [];
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        if (rectsOverlap(shapes[i], shapes[j])) solapes.push(`${shapes[i].id}/${shapes[j].id}`);
      }
    }
    expect(solapes).toEqual([]);
  });

  it("ordena el proceso de izquierda a derecha", () => {
    expect(at("Inicio").x).toBeLessThan(at("Registrar").x);
    expect(at("Registrar").x).toBeLessThan(at("Verificar").x);
    expect(at("Verificar").x).toBeLessThan(at("Evaluar").x);
    expect(at("Evaluar").x).toBeLessThan(at("Otorgado").x);
  });

  it("no empuja a la derecha el nodo al que vuelve un bucle", () => {
    // Si la arista de retorno contase como avance, "Verificar" acabaría detrás
    // de "PedirDocs" y el diagrama saldría al revés.
    expect(at("Verificar").x).toBeLessThan(at("PedirDocs").x);
  });

  it("separa las dos ramas de una compuerta en filas distintas", () => {
    expect(at("Desembolsar").y).not.toBe(at("Rechazado").y);
  });

  it("alinea verticalmente los elementos de la ruta principal", () => {
    // Comparten centro aunque tengan tamaños distintos (evento 36, tarea 80).
    const centro = (r: Rect) => r.y + r.h / 2;
    expect(centro(at("Inicio"))).toBe(centro(at("Registrar")));
    expect(centro(at("Registrar"))).toBe(centro(at("Verificar")));
  });
});

describe("auto-layout: trazado de flechas", () => {
  const xml = prepareXml(PROCESO_CON_BUCLE);
  const shapes = shapesOf(xml);
  const edges = edgesOf(xml);

  it("ningún tramo de flecha pasa por encima de un elemento", () => {
    const cruces: string[] = [];
    for (const e of edges) {
      for (let i = 1; i < e.points.length; i++) {
        for (const r of shapes) {
          if (segmentCrossesRect(e.points[i - 1], e.points[i], r)) {
            cruces.push(`${e.id} cruza ${r.id}`);
          }
        }
      }
    }
    expect(cruces).toEqual([]);
  });

  it("usa solo tramos horizontales o verticales", () => {
    for (const e of edges) {
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1];
        const b = e.points[i];
        expect(a.x === b.x || a.y === b.y).toBe(true);
      }
    }
  });

  it("devuelve el bucle de retrabajo por debajo del diagrama", () => {
    const bucle = edges.find((e) => e.id === "f5")!;   // PedirDocs → Verificar
    const bottom = Math.max(...shapes.map((s) => s.y + s.h));
    const lane = Math.max(...bucle.points.map((p) => p.y));

    expect(lane).toBeGreaterThan(bottom);      // pasa por debajo de todo
    expect(bucle.points).toHaveLength(4);      // baja, viaja, sube
  });
});

describe("buildLayout", () => {
  it("coloca en la columna 0 los nodos sin entradas", () => {
    const nodes: Elem[] = [
      { id: "a", type: "startEvent" },
      { id: "b", type: "task" },
    ];
    const flows: Flow[] = [{ id: "f", source: "a", target: "b" }];

    const layout = buildLayout(nodes, flows);

    expect(layout.get("a")!.col).toBe(0);
    expect(layout.get("b")!.col).toBe(1);
  });

  it("no se cuelga con un ciclo cerrado", () => {
    const nodes: Elem[] = [
      { id: "a", type: "task" },
      { id: "b", type: "task" },
    ];
    const flows: Flow[] = [
      { id: "f1", source: "a", target: "b" },
      { id: "f2", source: "b", target: "a" },
    ];

    const layout = buildLayout(nodes, flows);

    expect(layout.size).toBe(2);
  });

  it("lee correctamente los elementos y flujos del XML", () => {
    const { nodes, flows } = parseElements(PROCESO_CON_BUCLE);

    expect(nodes).toHaveLength(10);
    expect(flows).toHaveLength(10);
    expect(flows.find((f) => f.id === "f5")).toEqual({
      id: "f5", source: "PedirDocs", target: "Verificar",
    });
  });
});
