// Tests del análisis automático: diagnóstico, propuesta de TO-BE y veredicto.
//
// Los hallazgos deben salir de los números y las palancas deben medirse
// re-simulando. Se comprueba que cada problema se detecta cuando existe, que no
// se inventan problemas cuando no los hay y que el veredicto aplica la regla de
// decisión sobre cifras correctas.

import { describe, expect, it } from "vitest";
import {
  analyzeScenario,
  compareScenarios,
  fmtDuration,
  renderDiagnosis,
  renderVerdict,
  type ScenarioData,
} from "./simAnalysis";
import { runSimulation, type SimConfig } from "./simEngine";
import type { NodeKind, SimFlow, SimGraph, SimNode } from "./simGraph";

// ── Proceso de crédito de ejemplo ───────────────────────────────────────────

function node(id: string, kind: NodeKind, name: string, incoming: string[], outgoing: string[]): SimNode {
  return {
    id, name, kind,
    bpmnType: kind === "task" ? "bpmn:UserTask" : `bpmn:${kind}`,
    cx: 0, cy: 0, width: 0, height: 0, incoming, outgoing,
  };
}

function flow(id: string, source: string, target: string): SimFlow {
  return { id, name: "", source, target, waypoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }], length: 1 };
}

/**
 * Registrar → Revisar (analista) → ¿Completa?
 *   no → Corregir → vuelve a Revisar
 *   sí → Esperar comité → Aprobar (analista) → fin
 */
function creditGraph(): SimGraph {
  const nodes = [
    node("start", "start", "Solicitud", [], ["f0"]),
    node("reg", "task", "Registrar", ["f0"], ["f1"]),
    node("rev", "task", "Revisar", ["f1", "f5"], ["f2"]),
    node("gw", "xor", "¿Completa?", ["f2"], ["f3", "f4"]),
    node("fix", "task", "Corregir", ["f3"], ["f5"]),
    node("wait", "event", "Esperar comité", ["f4"], ["f6"]),
    node("apr", "task", "Aprobar", ["f6"], ["f7"]),
    node("end", "end", "Fin", ["f7"], []),
  ];
  const flows = [
    flow("f0", "start", "reg"), flow("f1", "reg", "rev"), flow("f2", "rev", "gw"),
    flow("f3", "gw", "fix"), flow("f4", "gw", "wait"), flow("f5", "fix", "rev"),
    flow("f6", "wait", "apr"), flow("f7", "apr", "end"),
  ];
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    flows: new Map(flows.map((f) => [f.id, f])),
    starts: ["start"],
    boundaries: new Map(),
  };
}

function creditConfig(over: Partial<SimConfig> = {}): SimConfig {
  return {
    instances: 200,
    arrival: { kind: "fixed", mean: 30 },
    defaultTask: { kind: "fixed", mean: 5 },
    transferTime: 0,
    tasks: {
      reg: { duration: { kind: "fixed", mean: 5 } },
      rev: { duration: { kind: "fixed", mean: 40 }, resource: "Analista" },
      fix: { duration: { kind: "fixed", mean: 10 } },
      apr: { duration: { kind: "fixed", mean: 20 }, resource: "Analista" },
    },
    gateways: { gw: { f3: 0.4, f4: 0.6 } },
    delays: {},
    resources: { Analista: { capacity: 4, costPerHour: 30 } },
    seed: 7,
    ...over,
  };
}

function analyze(config: SimConfig) {
  const graph = creditGraph();
  return analyzeScenario({
    graph, config, result: runSimulation(graph, config), processName: "Crédito", scenarioLabel: "AS-IS",
  });
}

const understaffed = { Analista: { capacity: 2, costPerHour: 30 } };

// ── Diagnóstico ─────────────────────────────────────────────────────────────

describe("diagnóstico del AS-IS", () => {
  it("detecta el retrabajo y mide lo que se gana eliminándolo", () => {
    const a = analyze(creditConfig());
    const rework = a.findings.find((f) => f.kind === "retrabajo");
    const lever = a.levers.find((l) => l.kind === "eliminar-retrabajo");

    expect(rework?.elementIds).toContain("gw");
    expect(rework?.evidence).toContain("40 %");
    // Sin la rama de vuelta, "Revisar" se hace una sola vez por solicitud.
    expect(lever!.after.processing).toBeLessThan(a.baseline.processing);
    expect(lever!.after.costPerCase).toBeLessThan(a.baseline.costPerCase);
  });

  it("señala una espera fija y cuantifica quitarla", () => {
    const a = analyze(creditConfig({ delays: { wait: { kind: "fixed", mean: 1440 } } }));
    const lever = a.levers.find((l) => l.kind === "quitar-espera");

    expect(a.findings.find((f) => f.kind === "espera")?.severity).toBe("alta");
    expect(a.baseline.cycle - lever!.after.cycle).toBeGreaterThan(1000);
  });

  it("detecta el recurso saturado y mide el efecto de reforzarlo", () => {
    const a = analyze(creditConfig({ resources: understaffed }));
    const lever = a.levers.find((l) => l.kind === "ampliar-capacidad");

    expect(a.findings.some((f) => f.kind === "saturacion")).toBe(true);
    expect(lever!.after.waiting).toBeLessThan(a.baseline.waiting);
    // Contratar tiene un costo que la simulación no ve: se informa aparte.
    expect(lever!.extraCost).toBeGreaterThan(0);
  });

  it("propone automatizar la tarea manual que más tiempo consume", () => {
    const a = analyze(creditConfig({ resources: understaffed }));
    const lever = a.levers.find((l) => l.kind === "automatizar");

    expect(lever?.elementIds).toEqual(["rev"]);
    expect(lever!.after.costPerCase).toBeLessThan(a.baseline.costPerCase);
  });

  it("ordena las palancas de mayor a menor reducción del cycle time", () => {
    const a = analyze(creditConfig({
      resources: understaffed,
      delays: { wait: { kind: "fixed", mean: 1440 } },
    }));
    const cycles = a.levers.map((l) => l.after.cycle);

    expect(cycles).toEqual([...cycles].sort((x, y) => x - y));
  });

  it("propone el TO-BE con el mismo equipo y deja la contratación aparte", () => {
    const a = analyze(creditConfig({
      resources: understaffed,
      delays: { wait: { kind: "fixed", mean: 1440 } },
    }));
    const md = renderDiagnosis(a);

    expect(a.combined).not.toBeNull();
    expect(md).toContain("rediseño con el mismo equipo");
    expect(md).toContain("Solo si la cola persiste");
  });

  it("señala cuánto frena el horario laboral", () => {
    // Solicitudes 24/7 y analistas de lunes a viernes de 9 a 17: las que llegan
    // de noche o en fin de semana se quedan paradas hasta que abre el turno.
    const a = analyze(creditConfig({
      arrival: { kind: "fixed", mean: 120 },
      resources: { Analista: { capacity: 4, costPerHour: 30, timetableId: "lv" } },
      timetables: { lv: { id: "lv", name: "L-V 9-17", beginDay: 1, endDay: 5, beginMin: 540, endMin: 1020 } },
      startDateMs: new Date(2026, 8, 7, 9, 0, 0, 0).getTime(),
    }));

    expect(a.kpis.idle).toBeGreaterThan(0);
    expect(a.findings.some((f) => f.kind === "horario")).toBe(true);
  });

  it("con turnos, reforzar suma una persona a cada turno", () => {
    // Un analista por turno las 24 h y una llegada cada 30 min: saturado.
    const everyDay = { beginDay: 0, endDay: 6 };
    const a = analyze(creditConfig({
      resources: {
        Analista: {
          capacity: 1,
          costPerHour: 30,
          shifts: [
            { ...everyDay, beginMin: 360, endMin: 1320, capacity: 1 },
            { ...everyDay, beginMin: 1320, endMin: 360, capacity: 1 },
          ],
        },
      },
      startDateMs: new Date(2026, 8, 7, 9, 0, 0, 0).getTime(),
    }));
    const lever = a.levers.find((l) => l.kind === "ampliar-capacidad");

    expect(lever?.title).toContain("por turno");
    expect(lever!.after.waiting).toBeLessThan(a.baseline.waiting);
    expect(lever!.extraCost).toBeGreaterThan(0);
  });

  it("no inventa problemas en un proceso sano", () => {
    const a = analyze(creditConfig({
      gateways: { gw: { f3: 0, f4: 1 } },
      resources: { Analista: { capacity: 6, costPerHour: 30 } },
      arrival: { kind: "fixed", mean: 120 },
    }));

    expect(a.findings).toEqual([]);
    expect(a.levers).toEqual([]);
    expect(a.combined).toBeNull();
    expect(renderDiagnosis(a)).toContain("Ningún recurso supera");
  });

  it("entrega las seis secciones del diagnóstico", () => {
    const md = renderDiagnosis(analyze(creditConfig()));

    for (const section of ["Diagnóstico", "Cuellos de botella", "Desperdicios", "Qué mejorar", "Diseño del TO-BE", "Impacto esperado"]) {
      expect(md).toContain(section);
    }
  });
});

// ── Veredicto ───────────────────────────────────────────────────────────────

function scenario(over: Partial<ScenarioData> = {}): ScenarioData {
  return {
    name: "Crédito",
    currency: "$",
    completed: 100,
    started: 100,
    avgCycle: 1000,
    avgCycleExcl: 500,
    avgProcessing: 100,
    avgWaiting: 900,
    cycleEfficiency: 0.1,
    throughputPerHour: 2,
    totalCost: 5000,
    activities: [],
    resources: [{ name: "Analista", capacity: 4, utilization: 0.95, cost: 5000 }],
    ...over,
  };
}

describe("veredicto AS-IS vs TO-BE", () => {
  it("recomienda implementar si mejora sin riesgos", () => {
    const c = compareScenarios(scenario(), scenario({
      avgCycle: 400,
      avgWaiting: 300,
      totalCost: 2000,
      cycleEfficiency: 0.25,
      resources: [{ name: "Analista", capacity: 4, utilization: 0.5, cost: 2000 }],
    }));

    expect(c.decision).toBe("implementar");
    expect(c.cycleChange).toBeCloseTo(-0.6, 6);
    expect(c.costPerCaseChange).toBeCloseTo(-0.6, 6);
    expect(renderVerdict(c)).toContain("Se implementa el TO-BE");
  });

  it("pide ajustes si el TO-BE deja un recurso al límite", () => {
    const c = compareScenarios(scenario(), scenario({
      avgCycle: 400,
      totalCost: 2000,
      resources: [{ name: "Analista", capacity: 2, utilization: 0.93, cost: 2000 }],
    }));

    expect(c.decision).toBe("implementar-con-ajustes");
    expect(c.risks.join(" ")).toContain("Analista");
  });

  it("no recomienda un TO-BE que empeora tiempo y costo", () => {
    const c = compareScenarios(scenario(), scenario({ avgCycle: 1200, totalCost: 6000 }));

    expect(c.decision).toBe("no-implementar");
  });

  it("compara el costo por solicitud, no el total", () => {
    // Menos costo total pero también menos solicitudes terminadas: no es ahorro.
    const c = compareScenarios(scenario(), scenario({ totalCost: 4000, completed: 80 }));

    expect(c.costPerCaseChange).toBeCloseTo(0, 6);
    expect(c.decision).toBe("no-implementar");
    expect(c.risks.join(" ")).toContain("80/100");
  });

  it("explica qué actividades desaparecen en el TO-BE", () => {
    const c = compareScenarios(
      scenario({ activities: [{ name: "Solicitar documentos", visits: 40, proc: 15, wait: 0, cost: 300 }] }),
      scenario({ avgCycle: 500, totalCost: 2500 }),
    );

    expect(renderVerdict(c)).toContain("«Solicitar documentos»");
  });

  it("no da por eliminada una actividad que solo cambió de nombre", () => {
    const c = compareScenarios(
      scenario({ activities: [{ name: "Formalizar y desembolsar", visits: 100, proc: 20, wait: 0, cost: 400 }] }),
      scenario({
        avgCycle: 500,
        totalCost: 2500,
        activities: [{ name: "Formalizar y desembolsar en línea", visits: 100, proc: 5, wait: 0, cost: 0 }],
      }),
    );

    expect(renderVerdict(c)).not.toContain("Ya no están en el TO-BE");
  });
});

describe("fmtDuration", () => {
  it("no muestra 60 minutos ni 24 horas al redondear", () => {
    expect(fmtDuration(119.6)).toBe("2h 0m");
    expect(fmtDuration(1439.9)).toBe("1d 0h");
    expect(fmtDuration(1439.4)).toBe("23h 59m");
  });

  it("usa minutos con un decimal por debajo de una hora", () => {
    expect(fmtDuration(30)).toBe("30.0 min");
    expect(fmtDuration(0)).toBe("0.0 min");
  });
});
