// Tests del motor de simulación de eventos discretos.
//
// Cada bloque cubre un fallo real que se corrigió: son una red de seguridad
// contra regresiones, no una especificación exhaustiva del motor.

import { describe, expect, it } from "vitest";
import { runSimulation, type ResourceDef, type SimConfig } from "./simEngine";
import type { Shift } from "./shifts";
import type { SimGraph, SimNode, SimFlow, NodeKind } from "./simGraph";

// ── Utilidades para construir grafos a mano ─────────────────────────────────

function node(id: string, kind: NodeKind, incoming: string[] = [], outgoing: string[] = []): SimNode {
  return {
    id, name: id, kind, bpmnType: `bpmn:${kind}`,
    cx: 0, cy: 0, width: 0, height: 0, incoming, outgoing,
  };
}

function flow(id: string, source: string, target: string): SimFlow {
  return {
    id, name: "", source, target,
    waypoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    length: 1,
  };
}

function graphOf(nodes: SimNode[], flows: SimFlow[], starts: string[]): SimGraph {
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    flows: new Map(flows.map((f) => [f.id, f])),
    starts,
    boundaries: new Map(),
  };
}

/** Inicio → tarea → fin. */
function linearGraph(): SimGraph {
  return graphOf(
    [
      node("start", "start", [], ["f0"]),
      node("T", "task", ["f0"], ["f1"]),
      node("end", "end", ["f1"], []),
    ],
    [flow("f0", "start", "T"), flow("f1", "T", "end")],
    ["start"],
  );
}

/** Inicio → compuerta paralela → dos tareas → dos finales (sin join). */
function parallelGraph(): SimGraph {
  return graphOf(
    [
      node("start", "start", [], ["f0"]),
      node("and", "and", ["f0"], ["f1", "f2"]),
      node("A", "task", ["f1"], ["f3"]),
      node("B", "task", ["f2"], ["f4"]),
      node("endA", "end", ["f3"], []),
      node("endB", "end", ["f4"], []),
    ],
    [
      flow("f0", "start", "and"), flow("f1", "and", "A"), flow("f2", "and", "B"),
      flow("f3", "A", "endA"), flow("f4", "B", "endB"),
    ],
    ["start"],
  );
}

/** Inicio → tarea → (sin salida). Nunca llega a un fin. */
function deadEndGraph(): SimGraph {
  return graphOf(
    [node("start", "start", [], ["f0"]), node("T", "task", ["f0"], [])],
    [flow("f0", "start", "T")],
    ["start"],
  );
}

function config(over: Partial<SimConfig> = {}): SimConfig {
  return {
    instances: 100,
    arrival: { kind: "fixed", mean: 10 },
    defaultTask: { kind: "fixed", mean: 5 },
    transferTime: 0.5,
    tasks: {},
    gateways: {},
    resources: {},
    seed: 42,
    ...over,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("conteo de instancias", () => {
  it("cuenta cada instancia una sola vez aunque varias ramas lleguen al final", () => {
    // Con ramas paralelas sin join, cada token que alcanzaba un evento de fin
    // sumaba a `completed`: el panel llegaba a mostrar más completadas que
    // iniciadas e inflaba el throughput.
    const r = runSimulation(parallelGraph(), config());

    expect(r.started).toBe(100);
    expect(r.completed).toBe(100);
    expect(r.completed).toBeLessThanOrEqual(r.started);
  });

  it("avisa cuando ninguna instancia alcanza un evento de fin", () => {
    const r = runSimulation(deadEndGraph(), config({ instances: 5 }));

    expect(r.completed).toBe(0);
    expect(r.warnings.join(" ")).toContain("evento de fin");
  });
});

describe("agregados y warmup", () => {
  it("mantiene la eficiencia dentro de [0, 1]", () => {
    // El warmup solo recortaba el cycle time, mientras proceso y espera se
    // promediaban sobre todas las instancias: la eficiencia podía superar 100 %.
    const r = runSimulation(linearGraph(), config({ warmupPercent: 50 }));

    expect(r.cycleEfficiency).toBeGreaterThanOrEqual(0);
    expect(r.cycleEfficiency).toBeLessThanOrEqual(1);
  });

  it("descarta el porcentaje de warmup indicado", () => {
    const r = runSimulation(linearGraph(), config({ instances: 100, warmupPercent: 30 }));

    expect(r.completed).toBe(100);          // la corrida completa
    expect(r.cycleSamples).toHaveLength(70); // pero las estadísticas, no
  });

  it("usa la misma población para el cycle time y el tiempo de proceso", () => {
    const r = runSimulation(linearGraph(), config({ warmupPercent: 50 }));

    expect(r.avgProcessing).toBeLessThanOrEqual(r.avgCycle);
  });
});

// Son pruebas de pila y de memoria, no de velocidad: en un equipo lento, o con
// otros ficheros de test en paralelo, 200.000 instancias superan los 5 s que
// Vitest concede por defecto sin que haya ningún fallo.
const HEAVY_TIMEOUT = 60_000;

describe("robustez ante corridas grandes", () => {
  it("no desborda la pila con 200.000 instancias", () => {
    // `Math.min(...arr)` reventaba a partir de ~100k elementos, justo al final
    // de la corrida, y el escenario admite instancias sin límite.
    const r = runSimulation(linearGraph(), config({ instances: 200_000 }));

    expect(r.completed).toBe(200_000);
    expect(Number.isFinite(r.minCycle)).toBe(true);
    expect(Number.isFinite(r.maxCycle)).toBe(true);
    expect(r.maxCycle).toBeGreaterThanOrEqual(r.minCycle);
  }, HEAVY_TIMEOUT);

  it("trunca la animación y lo avisa en lugar de agotar la memoria", () => {
    const r = runSimulation(linearGraph(), config({ instances: 200_000 }));

    expect(r.segments.length).toBeLessThanOrEqual(200_000);
    expect(r.warnings.join(" ")).toContain("animación");
  }, HEAVY_TIMEOUT);
});

describe("saneado de la configuración", () => {
  it("corrige una capacidad de recurso inválida en vez de bloquearse", () => {
    // Con capacidad 0 los tokens quedaban encolados para siempre: la corrida
    // terminaba con 0 completadas y sin ninguna explicación.
    const r = runSimulation(
      linearGraph(),
      config({
        instances: 20,
        tasks: { T: { duration: { kind: "fixed", mean: 5 }, resource: "R" } },
        resources: { R: { capacity: 0, costPerHour: 10 } },
      }),
    );

    expect(r.completed).toBe(20);
    expect(r.warnings.join(" ")).toContain("capacidad");
  });

  it("trata un nº de instancias no numérico como una sola instancia", () => {
    const r = runSimulation(linearGraph(), config({ instances: Number.NaN }));

    expect(r.started).toBe(1);
  });

  it("respeta la capacidad del recurso al repartir el trabajo", () => {
    const r = runSimulation(
      linearGraph(),
      config({
        instances: 10,
        arrival: { kind: "fixed", mean: 0 }, // todas llegan a la vez
        tasks: { T: { duration: { kind: "fixed", mean: 10 }, resource: "R" } },
        resources: { R: { capacity: 1, costPerHour: 60 } },
      }),
    );

    // Un solo recurso y llegadas simultáneas ⇒ hay cola de verdad.
    expect(r.avgWaiting).toBeGreaterThan(0);
    // 10 instancias × 10 min a 60 $/h = 100 min de trabajo = 100 $.
    expect(r.totalCost).toBeCloseTo(100, 5);
  });
});

describe("determinismo", () => {
  it("la misma semilla produce el mismo resultado", () => {
    const a = runSimulation(linearGraph(), config({ seed: 7, arrival: { kind: "exponential", mean: 10 } }));
    const b = runSimulation(linearGraph(), config({ seed: 7, arrival: { kind: "exponential", mean: 10 } }));

    expect(b.avgCycle).toBe(a.avgCycle);
    expect(b.totalCost).toBe(a.totalCost);
  });
});

// ── Grafos para horarios, eventos de borde y compuertas inclusivas ──────────

/** Inicio → T → W → fin. */
function twoTaskGraph(): SimGraph {
  return graphOf(
    [
      node("start", "start", [], ["f0"]),
      node("T", "task", ["f0"], ["f1"]),
      node("W", "task", ["f1"], ["f2"]),
      node("end", "end", ["f2"], []),
    ],
    [flow("f0", "start", "T"), flow("f1", "T", "W"), flow("f2", "W", "end")],
    ["start"],
  );
}

/** T con dos eventos de borde: I interrumpe; N no interrumpe y lleva a X. */
function boundaryGraph(): SimGraph {
  const g = graphOf(
    [
      node("start", "start", [], ["f0"]),
      node("T", "task", ["f0"], ["f1"]),
      node("end", "end", ["f1"], []),
      { ...node("I", "boundary", [], ["fI"]), attachedTo: "T", interrupting: true },
      node("endI", "end", ["fI"], []),
      { ...node("N", "boundary", [], ["fN"]), attachedTo: "T", interrupting: false },
      node("X", "task", ["fN"], ["fX"]),
      node("endN", "end", ["fX"], []),
    ],
    [
      flow("f0", "start", "T"), flow("f1", "T", "end"),
      flow("fI", "I", "endI"), flow("fN", "N", "X"), flow("fX", "X", "endN"),
    ],
    ["start"],
  );
  g.boundaries.set("T", ["I", "N"]);
  return g;
}

/** Inicio → inclusiva (split) → A | B → inclusiva (join) → C → fin. */
function inclusiveGraph(): SimGraph {
  return graphOf(
    [
      node("start", "start", [], ["f0"]),
      node("split", "or", ["f0"], ["f1", "f2"]),
      node("A", "task", ["f1"], ["f3"]),
      node("B", "task", ["f2"], ["f4"]),
      node("join", "or", ["f3", "f4"], ["f5"]),
      node("C", "task", ["f5"], ["f6"]),
      node("end", "end", ["f6"], []),
    ],
    [
      flow("f0", "start", "split"), flow("f1", "split", "A"), flow("f2", "split", "B"),
      flow("f3", "A", "join"), flow("f4", "B", "join"),
      flow("f5", "join", "C"), flow("f6", "C", "end"),
    ],
    ["start"],
  );
}

const visitsOf = (r: ReturnType<typeof runSimulation>, id: string) =>
  r.activities.find((a) => a.id === id)?.visits ?? 0;

// Lunes 7-sep-2026. El horario se evalúa en hora local, igual que en el motor.
const monday = (hour: number) => new Date(2026, 8, 7, hour, 0, 0, 0).getTime();
const WEEKDAYS_9_TO_17 = { id: "lv", name: "L-V 9-17", beginDay: 1, endDay: 5, beginMin: 540, endMin: 1020 };

/** Tarea T atendida por R: horario L-V 9-17 y 60 $/h (1 $ por minuto). */
function withShift(over: Partial<SimConfig>, workMin: number, capacity = 1): SimConfig {
  return config({
    transferTime: 0,
    tasks: { T: { duration: { kind: "fixed", mean: workMin }, resource: "R" } },
    resources: { R: { capacity, costPerHour: 60, timetableId: "lv" } },
    timetables: { lv: WEEKDAYS_9_TO_17 },
    ...over,
  });
}

/**
 * Proceso de crédito del escenario determinista S1:
 * registrar → verificar → evaluar → comité → desembolsar, sin ramas aleatorias.
 */
function referenceCreditGraph(): SimGraph {
  return graphOf(
    [
      node("start", "start", [], ["f1"]),
      node("reg", "task", ["f1"], ["f2"]),
      node("ver", "task", ["f2", "f5"], ["f3"]),
      node("docs", "xor", ["f3"], ["f4", "f6"]),
      node("pedir", "task", ["f4"], ["f5"]),
      node("eval", "task", ["f6"], ["f7"]),
      node("comite", "task", ["f7"], ["f8"]),
      node("decision", "xor", ["f8"], ["f9", "f10"]),
      node("desemb", "task", ["f9"], ["f11"]),
      node("ok", "end", ["f11"], []),
      node("no", "end", ["f10"], []),
    ],
    [
      flow("f1", "start", "reg"), flow("f2", "reg", "ver"), flow("f3", "ver", "docs"),
      flow("f4", "docs", "pedir"), flow("f5", "pedir", "ver"), flow("f6", "docs", "eval"),
      flow("f7", "eval", "comite"), flow("f8", "comite", "decision"),
      flow("f9", "decision", "desemb"), flow("f10", "decision", "no"), flow("f11", "desemb", "ok"),
    ],
    ["start"],
  );
}

/** 50 solicitudes cada 120 min hábiles; el analista se pasa como parámetro. */
function referenceCreditConfig(analyst: ResourceDef): SimConfig {
  return config({
    instances: 50,
    arrival: { kind: "fixed", mean: 120 },
    arrivalTimetableId: "lv",
    transferTime: 0,
    startDateMs: monday(9),
    timetables: {
      lv: WEEKDAYS_9_TO_17,
      "247": { id: "247", name: "24/7", beginDay: 0, endDay: 6, beginMin: 0, endMin: 1440 },
    },
    resources: {
      Analista: analyst,
      Sistema: { capacity: 100, costPerHour: 0, timetableId: "247" },
    },
    tasks: {
      reg: { duration: { kind: "fixed", mean: 10 }, resource: "Sistema" },
      ver: { duration: { kind: "fixed", mean: 25 }, resource: "Analista" },
      pedir: { duration: { kind: "fixed", mean: 15 }, resource: "Sistema" },
      eval: { duration: { kind: "fixed", mean: 45 }, resource: "Analista" },
      comite: { duration: { kind: "fixed", mean: 30 }, resource: "Analista" },
      desemb: { duration: { kind: "fixed", mean: 20 }, resource: "Sistema" },
    },
    gateways: { docs: { f4: 0, f6: 1 }, decision: { f9: 1, f10: 0 } },
  });
}

describe("horarios de trabajo", () => {
  it("cobra al recurso solo las horas trabajadas, no la noche intermedia", () => {
    // 600 min de trabajo desde el lunes 9:00: 480 el lunes y 120 el martes.
    // La ocupación del recurso se integraba en tiempo de reloj y facturaba
    // también las 16 h de la noche: su costo no cuadraba con el de las tareas.
    const r = runSimulation(linearGraph(), withShift({ instances: 1, startDateMs: monday(9) }, 600));

    expect(r.avgCycle).toBeCloseTo(1560, 5);        // lunes 9:00 → martes 11:00
    expect(r.avgProcessing).toBeCloseTo(600, 5);
    expect(r.avgCycleExcl).toBeCloseTo(600, 5);
    expect(r.totalCost).toBeCloseTo(600, 5);         // 10 h × 60 $/h
    expect(r.resources[0].busyTime).toBeCloseTo(600, 5);
    expect(r.resources[0].cost).toBeCloseTo(r.totalCost, 5);
  });

  it("mide la utilización sobre las horas en que el recurso está disponible", () => {
    // T ocupa 240 min del lunes; W (sin recurso) alarga el horizonte hasta el
    // miércoles 13:00. En ese tramo el recurso abre 480 + 480 + 240 = 1200 min.
    const r = runSimulation(twoTaskGraph(), withShift({
      instances: 1,
      startDateMs: monday(9),
      tasks: {
        T: { duration: { kind: "fixed", mean: 240 }, resource: "R" },
        W: { duration: { kind: "fixed", mean: 2880 } },
      },
    }, 240));

    expect(r.resources[0].utilization).toBeCloseTo(240 / 1200, 5);
  });

  it("cuenta como inactividad, no como espera, el tiempo hasta que abre el turno", () => {
    // Llega el lunes a las 20:00 con el recurso libre pero fuera de horario.
    // Antes esas 13 h no aparecían en ningún indicador. Son inactividad: la
    // espera se reserva para la cola.
    const r = runSimulation(linearGraph(), withShift({ instances: 1, startDateMs: monday(20) }, 60));

    expect(r.avgCycle).toBeCloseTo(840, 5);          // lunes 20:00 → martes 10:00
    expect(r.avgWaiting).toBeCloseTo(0, 5);          // nadie ocupaba al recurso
    expect(r.avgIdle).toBeCloseTo(780, 5);           // hasta el martes 9:00
    expect(r.avgProcessing + r.avgWaiting + r.avgIdle + r.avgTransfer).toBeCloseTo(r.avgCycle, 5);
    expect(r.avgCycleExcl).toBeCloseTo(60, 5);       // en horas hábiles solo hubo trabajo
  });

  it("no cuenta en el cycle time hábil la noche que se pasa en cola", () => {
    // Dos solicitudes el lunes a las 16:00 y un solo analista (120 min cada una).
    // La 2.ª espera hasta el martes 10:00: 18 h de reloj, pero solo 2 h hábiles.
    const r = runSimulation(linearGraph(), withShift({
      instances: 2,
      startDateMs: monday(16),
      arrival: { kind: "fixed", mean: 0 },
    }, 120));

    expect(r.avgCycle).toBeCloseTo((1080 + 1200) / 2, 5);
    // Espera en horas hábiles (la 2.ª: 1 h el lunes + 1 h el martes); la noche
    // es inactividad para las dos: la 1.ª con la tarea a medias, la 2.ª en cola.
    expect(r.avgWaiting).toBeCloseTo((0 + 120) / 2, 5);
    expect(r.avgIdle).toBeCloseTo(960, 5);
    expect(r.avgCycleExcl).toBeCloseTo((120 + 240) / 2, 5);
    expect(r.totalCost).toBeCloseTo(240, 5);
    expect(r.resources[0].cost).toBeCloseTo(240, 5);
    expect(r.resources[0].utilization).toBeCloseTo(1, 5);
  });
});

// ── Casos de referencia ───────────────────────────────────────────────────────
// Escenarios deterministas pequeños cuyo resultado se conoce de antemano.

describe("casos de referencia", () => {
  it("pausa la tarea al cierre y la retoma (M1)", () => {
    // 1 caso el lunes a las 16:30, tarea de 60 min, horario 9-17
    // → cycle 1020 min, duración 60, inactividad 960, utilización 1.0.
    const r = runSimulation(linearGraph(), withShift({ instances: 1, startDateMs: monday(16) + 30 * 60_000 }, 60));
    const task = r.activities.find((a) => a.id === "T")!;

    expect(r.avgCycle).toBeCloseTo(1020, 6);
    expect(task.totalProcessing).toBeCloseTo(60, 6);
    expect(task.totalIdle).toBeCloseTo(960, 6);
    expect(r.resources[0].utilization).toBeCloseTo(1, 6);
  });

  it("mide la cola (M3)", () => {
    // 2 casos a las 9:00, 1 analista, 60 min → espera media 30 (máx 60),
    // cycle medio 90, utilización 1.0.
    const r = runSimulation(linearGraph(), withShift({
      instances: 2,
      startDateMs: monday(9),
      arrival: { kind: "fixed", mean: 0 },
    }, 60));

    expect(r.avgWaiting).toBeCloseTo(30, 6);
    expect(r.avgIdle).toBeCloseTo(0, 6);
    expect(r.avgCycle).toBeCloseTo(90, 6);
    expect(r.resources[0].utilization).toBeCloseTo(1, 6);
  });

  it("clasifica la cola que cruza la noche (M4)", () => {
    // 2 casos (16:30 y 16:31), 1 analista, 60 min → espera media 29.5
    // (máx 59: 29 min el lunes + 30 el martes), inactividad 960 en los dos,
    // cycle medio 1049.5 y utilización 1.0.
    const r = runSimulation(linearGraph(), withShift({
      instances: 2,
      startDateMs: monday(16) + 30 * 60_000,
      arrival: { kind: "fixed", mean: 1 },
    }, 60));
    const task = r.activities.find((a) => a.id === "T")!;

    expect(task.totalWaiting / task.visits).toBeCloseTo(29.5, 6);
    expect(task.totalIdle / task.visits).toBeCloseTo(960, 6);
    expect(r.avgCycle).toBeCloseTo(1049.5, 6);
    expect(r.resources[0].utilization).toBeCloseTo(1, 6);
  });

  it("reproduce al minuto el escenario determinista (S1)", () => {
    // Las instancias solo se crean dentro del horario de llegadas: la de las 17:00
    // espera al día siguiente y la del viernes, al lunes.
    // Esperado: cycle mín 130 · medio 473.2 · máx 3960 min · costo 1500 · utilización
    // del analista 0.415973… · inactividad media en "Verificar" 343.2 min.
    const r = runSimulation(referenceCreditGraph(), referenceCreditConfig({ capacity: 2, costPerHour: 18, timetableId: "lv" }));
    const verify = r.activities.find((a) => a.id === "ver")!;
    const analyst = r.resources.find((x) => x.name === "Analista")!;

    expect(r.completed).toBe(50);
    expect(r.minCycle).toBeCloseTo(130, 6);
    expect(r.avgCycle).toBeCloseTo(473.2, 6);
    expect(r.maxCycle).toBeCloseTo(3960, 6);
    expect(r.totalCost).toBeCloseTo(1500, 6);
    expect(analyst.utilization).toBeCloseTo(0.415973377703827, 9);
    expect(verify.totalIdle / verify.visits).toBeCloseTo(343.2, 6);
    expect(r.avgWaiting).toBeCloseTo(0, 6);
  });
});

describe("eventos de borde", () => {
  it("no dispara un evento no interruptor después de que otro cancele la tarea", () => {
    // I interrumpe a los 10 min; N (a los 50) ya no debe lanzar su rama.
    const r = runSimulation(boundaryGraph(), config({
      instances: 10,
      transferTime: 0,
      tasks: { T: { duration: { kind: "fixed", mean: 100 } } },
      boundaries: { I: { kind: "fixed", mean: 10 }, N: { kind: "fixed", mean: 50 } },
    }));

    expect(visitsOf(r, "I")).toBe(10);
    expect(visitsOf(r, "N")).toBe(0);
    expect(visitsOf(r, "X")).toBe(0);
  });
});

describe("compuertas inclusivas", () => {
  it("el join une las ramas activadas en lugar de repetir lo que sigue", () => {
    // Con las dos ramas activas, C se ejecutaba dos veces por instancia (una por
    // cada token que alcanzaba el join): duplicaba visitas, tiempo y costo.
    const r = runSimulation(inclusiveGraph(), config({
      instances: 20,
      transferTime: 0,
      gateways: { split: { f1: 1, f2: 1 } },
    }));

    expect(visitsOf(r, "A")).toBe(20);
    expect(visitsOf(r, "B")).toBe(20);
    expect(visitsOf(r, "C")).toBe(20);
    expect(r.completed).toBe(20);
  });

  it("el join no espera a una rama que no se activó", () => {
    const r = runSimulation(inclusiveGraph(), config({
      instances: 20,
      transferTime: 0,
      gateways: { split: { f1: 1, f2: 0 } },
    }));

    expect(visitsOf(r, "B")).toBe(0);
    expect(visitsOf(r, "C")).toBe(20);
    expect(r.completed).toBe(20);
  });
});

// ── Turnos con dotación variable ──────────────────────────────────────────────

/** Recurso R con turnos (60 $/h) para una tarea T; llegadas 24/7. */
function withShifts(over: Partial<SimConfig>, workMin: number, shifts: Shift[]): SimConfig {
  return config({
    transferTime: 0,
    tasks: { T: { duration: { kind: "fixed", mean: workMin }, resource: "R" } },
    resources: { R: { capacity: 1, costPerHour: 60, shifts } },
    ...over,
  });
}

const EVERY_DAY = { beginDay: 0, endDay: 6 };
const DAY_MS = 1440 * 60_000;

describe("turnos", () => {
  it("con un solo turno da lo mismo que un horario (caso M4)", () => {
    const r = runSimulation(linearGraph(), withShifts({
      instances: 2,
      startDateMs: monday(16) + 30 * 60_000,
      arrival: { kind: "fixed", mean: 1 },
    }, 60, [{ beginDay: 1, endDay: 5, beginMin: 540, endMin: 1020, capacity: 1 }]));
    const task = r.activities.find((a) => a.id === "T")!;

    expect(task.totalWaiting / task.visits).toBeCloseTo(29.5, 6);
    expect(task.totalIdle / task.visits).toBeCloseTo(960, 6);
    expect(r.avgCycle).toBeCloseTo(1049.5, 6);
    expect(r.resources[0].utilization).toBeCloseTo(1, 6);
  });

  it("con un solo turno reproduce el escenario determinista (S1)", () => {
    const r = runSimulation(referenceCreditGraph(), referenceCreditConfig({
      capacity: 2,
      costPerHour: 18,
      shifts: [{ beginDay: 1, endDay: 5, beginMin: 540, endMin: 1020, capacity: 2 }],
    }));
    const verify = r.activities.find((a) => a.id === "ver")!;

    expect(r.avgCycle).toBeCloseTo(473.2, 6);
    expect(r.maxCycle).toBeCloseTo(3960, 6);
    expect(r.resources.find((x) => x.name === "Analista")!.utilization).toBeCloseTo(0.415973377703827, 9);
    expect(verify.totalIdle / verify.visits).toBeCloseTo(343.2, 6);
  });

  it("con tres turnos de 8 h la noche no es inactividad", () => {
    // Una persona en cada turno, todos los días: la tarea que empieza a las 21:30
    // sigue sin pausa tras el relevo de las 22:00.
    const r = runSimulation(linearGraph(), withShifts({ instances: 1, startDateMs: monday(21) + 30 * 60_000 }, 60, [
      { ...EVERY_DAY, beginMin: 360, endMin: 840, capacity: 1 },
      { ...EVERY_DAY, beginMin: 840, endMin: 1320, capacity: 1 },
      { ...EVERY_DAY, beginMin: 1320, endMin: 360, capacity: 1 },
    ]));

    expect(r.avgCycle).toBeCloseTo(60, 6);
    expect(r.avgIdle).toBeCloseTo(0, 6);
  });

  it("si entra un turno con menos personas, la tarea más reciente espera", () => {
    // 2 personas de 6 a 22 y 1 de 22 a 6. Tareas de 120 min a las 21:00 y 21:30.
    // A las 22:00 solo queda una persona: la 2.ª (30 min hechos) vuelve a la cola,
    // retoma a las 23:00 cuando termina la 1.ª y acaba a las 00:30.
    const r = runSimulation(linearGraph(), withShifts({
      instances: 2,
      startDateMs: monday(21),
      arrival: { kind: "fixed", mean: 30 },
    }, 120, [
      { ...EVERY_DAY, beginMin: 360, endMin: 1320, capacity: 2 },
      { ...EVERY_DAY, beginMin: 1320, endMin: 360, capacity: 1 },
    ]));

    expect(r.cycleSamples).toEqual([120, 180]);
    expect(r.avgWaiting).toBeCloseTo((0 + 60) / 2, 6);
    expect(r.avgIdle).toBeCloseTo(0, 6);
    expect(r.avgProcessing).toBeCloseTo(120, 6);
  });

  it("un turno nocturno cruza la medianoche y respeta el fin de semana", () => {
    const nights = [{ beginDay: 1, endDay: 5, beginMin: 1320, endMin: 360, capacity: 1 }];
    // Viernes 23:30: el turno empezó a las 22:00 y sigue hasta el sábado 06:00.
    const friday = runSimulation(linearGraph(), withShifts({ instances: 1, startDateMs: monday(23) + 4 * DAY_MS + 30 * 60_000 }, 60, nights));
    // Sábado 23:30: no hay turno hasta el lunes 22:00 (46 h 30 min parada).
    const saturday = runSimulation(linearGraph(), withShifts({ instances: 1, startDateMs: monday(23) + 5 * DAY_MS + 30 * 60_000 }, 60, nights));

    expect(friday.avgCycle).toBeCloseTo(60, 6);
    expect(saturday.avgIdle).toBeCloseTo(46 * 60 + 30, 6);
    expect(saturday.avgCycle).toBeCloseTo(46 * 60 + 30 + 60, 6);
  });

  it("mide la utilización sobre las personas-minuto disponibles", () => {
    // 60 min de trabajo el lunes a las 9:00 con 2 personas en turno → 60 / 120.
    const r = runSimulation(linearGraph(), withShifts({ instances: 1, startDateMs: monday(9) }, 60, [
      { ...EVERY_DAY, beginMin: 360, endMin: 1320, capacity: 2 },
      { ...EVERY_DAY, beginMin: 1320, endMin: 360, capacity: 1 },
    ]));

    expect(r.resources[0].utilization).toBeCloseTo(0.5, 6);
    expect(r.resources[0].variableCapacity).toBe(true);
    expect(r.resources[0].capacity).toBe(2);
    expect(r.totalCost).toBeCloseTo(60, 6);
  });

  it("avisa y no se bloquea si ningún turno tiene personas", () => {
    const r = runSimulation(linearGraph(), withShifts({ instances: 3, startDateMs: monday(9) }, 10, [
      { ...EVERY_DAY, beginMin: 540, endMin: 1020, capacity: 0 },
    ]));

    expect(r.completed).toBe(3);
    expect(r.warnings.join(" ")).toContain("turno");
  });
});
