/**
 * Preparación del XML BPMN antes de abrirlo en el editor.
 *
 * Toma un BPMN cualquiera —con o sin prefijos de espacio de nombres, con o sin
 * información de diagrama (DI)— y devuelve uno que bpmn-js puede pintar:
 *
 *   1. normaliza los espacios de nombres,
 *   2. descarta la DI existente (a menudo incompleta o de otra herramienta),
 *   3. lee elementos y flujos,
 *   4. calcula una disposición en columnas y filas,
 *   5. genera la DI (formas y trazados de las flechas).
 *
 * Vive fuera del componente por ser lógica pura: así se puede probar sin montar
 * React ni bpmn-js (ver prepareXml.test.ts).
 */

// ── Namespace URIs ────────────────────────────────────────────────────────────
export const NS_BPMN   = "http://www.omg.org/spec/BPMN/20100524/MODEL";
export const NS_BPMNDI = "http://www.omg.org/spec/BPMN/20100524/DI";
export const NS_DC     = "http://www.omg.org/spec/DD/20100524/DC";
export const NS_DI     = "http://www.omg.org/spec/DD/20100524/DI";

const ALL_NS = [
  `xmlns:bpmn="${NS_BPMN}"`,
  `xmlns:bpmndi="${NS_BPMNDI}"`,
  `xmlns:dc="${NS_DC}"`,
  `xmlns:di="${NS_DI}"`,
  `targetNamespace="http://bpmn.io/schema/bpmn"`,
].join(" ");

// Diagrama en blanco SIEMPRE válido (con DI). Respaldo cuando el XML no tiene
// elementos reconocibles o falla la importación, para no mostrar "no diagram to display".
export const BLANK_DIAGRAM = `<?xml version="1.0" encoding="UTF-8"?>
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
export function elSize(type: string): { w: number; h: number } {
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
export interface Elem { id: string; type: string }
export interface Flow { id: string; source: string; target: string }
interface Parsed { processId: string; nodes: Elem[]; flows: Flow[] }

export function parseElements(xml: string): Parsed {
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

// ── Step 4: Auto-layout ──────────────────────────────────────────────────────
// Coloca los elementos en columnas (orden del flujo) y filas (ramas), tratando
// de que las ramas de una compuerta queden juntas y sin cruces innecesarios.
export interface LayoutElem extends Elem { col: number; row: number }

export function buildLayout(nodes: Elem[], flows: Flow[]): Map<string, LayoutElem> {
  const ids = new Set(nodes.map((n) => n.id));
  const edges = flows.filter((f) => ids.has(f.source) && ids.has(f.target));

  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const n of nodes) { out.set(n.id, []); inc.set(n.id, []); }
  for (const f of edges) {
    out.get(f.source)!.push(f.target);
    inc.get(f.target)!.push(f.source);
  }

  // ── 1. Detectar las aristas de retorno (bucles de retrabajo) ──────────────
  // Hay que apartarlas antes de calcular columnas: si se cuentan como avance, el
  // ranking se realimenta —cada vuelta empuja el nodo un poco más a la derecha—
  // y el diagrama acaba con columnas absurdas.
  const back = new Set<string>();      // "origen>destino"
  const state = new Map<string, 0 | 1 | 2>(); // 0 sin ver · 1 en la pila · 2 cerrado

  const roots = nodes
    .filter((n) => n.type === "startEvent" || (inc.get(n.id) ?? []).length === 0)
    .map((n) => n.id);
  const order = [...roots, ...nodes.map((n) => n.id)];

  for (const root of order) {
    if (state.get(root)) continue;
    // DFS iterativo: los procesos grandes desbordarían la pila con recursión.
    const stack: Array<{ id: string; next: number }> = [{ id: root, next: 0 }];
    state.set(root, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const children = out.get(frame.id) ?? [];
      if (frame.next >= children.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const child = children[frame.next++];
      const st = state.get(child) ?? 0;
      if (st === 1) {
        back.add(`${frame.id}>${child}`); // vuelve a un ancestro → es un bucle
      } else if (st === 0) {
        state.set(child, 1);
        stack.push({ id: child, next: 0 });
      }
    }
  }

  const forward = edges.filter((f) => !back.has(`${f.source}>${f.target}`));

  // ── 2. Columnas: camino más largo sobre el grafo ya sin ciclos ────────────
  const degree = new Map<string, number>();
  const fwdOut = new Map<string, string[]>();
  for (const n of nodes) { degree.set(n.id, 0); fwdOut.set(n.id, []); }
  for (const f of forward) {
    fwdOut.get(f.source)!.push(f.target);
    degree.set(f.target, (degree.get(f.target) ?? 0) + 1);
  }

  const col = new Map<string, number>();
  const queue = nodes.filter((n) => (degree.get(n.id) ?? 0) === 0).map((n) => n.id);
  for (const id of queue) col.set(id, 0);

  while (queue.length) {
    const id = queue.shift()!;
    const c = col.get(id) ?? 0;
    for (const tgt of fwdOut.get(id) ?? []) {
      col.set(tgt, Math.max(col.get(tgt) ?? 0, c + 1));
      const left = (degree.get(tgt) ?? 0) - 1;
      degree.set(tgt, left);
      if (left === 0) queue.push(tgt);
    }
  }
  for (const n of nodes) if (!col.has(n.id)) col.set(n.id, 0);

  // ── 3. Filas: baricentro de los predecesores ──────────────────────────────
  // Cada nodo se sitúa a la altura media de quienes le apuntan, así las ramas de
  // una compuerta se abren arriba/abajo en vez de mezclarse.
  const byCol = new Map<number, string[]>();
  for (const n of nodes) {
    const c = col.get(n.id)!;
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(n.id);
  }

  const row = new Map<string, number>();
  for (const c of [...byCol.keys()].sort((a, b) => a - b)) {
    const column = byCol.get(c)!;
    const desired = new Map<string, number>();
    for (const id of column) {
      const parents = (inc.get(id) ?? []).filter((pid) => (col.get(pid) ?? 0) < c && row.has(pid));
      desired.set(
        id,
        parents.length
          ? parents.reduce((acc, pid) => acc + (row.get(pid) ?? 0), 0) / parents.length
          : 0,
      );
    }
    const ordered = [...column].sort(
      (a, b) => (desired.get(a)! - desired.get(b)!) || a.localeCompare(b),
    );
    const taken = new Set<number>();
    for (const id of ordered) {
      let r = Math.round(desired.get(id)!);
      while (taken.has(r)) r += 1; // sin solapes dentro de la columna
      taken.add(r);
      row.set(id, r);
    }
  }

  let minRow = 0;
  for (const r of row.values()) if (r < minRow) minRow = r;

  const result = new Map<string, LayoutElem>();
  for (const n of nodes) {
    result.set(n.id, { ...n, col: col.get(n.id) ?? 0, row: (row.get(n.id) ?? 0) - minRow });
  }
  return result;
}

// ── Step 5: Generate bpmndi:BPMNDiagram XML ───────────────────────────────────
const SLOT_W = 100;  // ancho de referencia de una columna (una tarea)
const SLOT_H = 80;   // alto de referencia de una fila
const COL_GAP = 100; // hueco entre columnas — por él pasan los tramos verticales
const ROW_GAP = 60;  // hueco entre filas
const COL_W = SLOT_W + COL_GAP;
const ROW_H = SLOT_H + ROW_GAP;
const OX = 150;      // margen izquierdo
const OY = 90;       // margen superior
const LOOP_DROP = 45;  // separación entre el diagrama y el primer carril de bucles
const LOOP_LANE = 40;  // separación entre carriles de bucles

/** Centro del elemento: todos comparten eje, así las flechas salen rectas. */
function centerOf(n: LayoutElem): { cx: number; cy: number } {
  return { cx: OX + n.col * COL_W + SLOT_W / 2, cy: OY + n.row * ROW_H + SLOT_H / 2 };
}

const wp = (x: number, y: number) =>
  `        <di:waypoint x="${Math.round(x)}" y="${Math.round(y)}" />`;

function injectDiagram(xml: string, processId: string, layout: Map<string, LayoutElem>, flows: Flow[]): string {
  const shapes = [...layout.values()].map((n) => {
    const { w, h } = elSize(n.type);
    const { cx, cy } = centerOf(n);
    return `      <bpmndi:BPMNShape id="Shape_${n.id}" bpmnElement="${n.id}">\n`
         + `        <dc:Bounds x="${Math.round(cx - w / 2)}" y="${Math.round(cy - h / 2)}" width="${w}" height="${h}" />\n`
         + `      </bpmndi:BPMNShape>`;
  }).join("\n");

  // Fila más baja ocupada en cada columna: sirve para bajar los bucles por
  // debajo de todo lo que atraviesan, en lugar de cruzarlo por el medio.
  const deepestRow = new Map<number, number>();
  for (const n of layout.values()) {
    deepestRow.set(n.col, Math.max(deepestRow.get(n.col) ?? 0, n.row));
  }

  let loopIndex = 0;
  const edges = flows.map((f) => {
    const s = layout.get(f.source);
    const t = layout.get(f.target);
    if (!s || !t) return "";
    const { w: sw, h: sh } = elSize(s.type);
    const { w: tw, h: th } = elSize(t.type);
    const { cx: sx, cy: sy } = centerOf(s);
    const { cx: tx, cy: ty } = centerOf(t);

    let pts: string[];

    if (t.col > s.col) {
      // ── Avance normal: sale por la derecha, entra por la izquierda ─────────
      const x1 = sx + sw / 2;
      const x2 = tx - tw / 2;
      if (Math.abs(sy - ty) < 1) {
        pts = [wp(x1, sy), wp(x2, ty)];
      } else {
        // El tramo vertical se traza por el hueco ENTRE columnas, que siempre
        // está libre; antes se usaba el punto medio, que podía caer dentro de
        // otra caja.
        const gutter = t.col === s.col + 1
          ? (x1 + x2) / 2
          : tx - SLOT_W / 2 - COL_GAP / 2;
        pts = [wp(x1, sy), wp(gutter, sy), wp(gutter, ty), wp(x2, ty)];
      }
    } else {
      // ── Bucle de retorno: se dibuja POR DEBAJO, como en cualquier herramienta
      // BPMN. Antes volvía en línea recta y se montaba sobre las tareas.
      const from = Math.min(s.col, t.col);
      const to = Math.max(s.col, t.col);
      let deepest = 0;
      for (let c = from; c <= to; c++) deepest = Math.max(deepest, deepestRow.get(c) ?? 0);
      const lane = OY + deepest * ROW_H + SLOT_H + LOOP_DROP + loopIndex * LOOP_LANE;
      loopIndex += 1;
      pts = [wp(sx, sy + sh / 2), wp(sx, lane), wp(tx, lane), wp(tx, ty + th / 2)];
    }

    return `      <bpmndi:BPMNEdge id="Edge_${f.id}" bpmnElement="${f.id}">\n${pts.join("\n")}\n      </bpmndi:BPMNEdge>`;
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
export function prepareXml(raw: string): string {
  const xml   = fixNamespaces(raw);
  const clean = stripDiagram(xml);
  const { processId, nodes, flows } = parseElements(clean);

  if (nodes.length === 0) return BLANK_DIAGRAM; // sin elementos → diagrama en blanco válido

  const layout = buildLayout(nodes, flows);
  return injectDiagram(clean, processId, layout, flows);
}
