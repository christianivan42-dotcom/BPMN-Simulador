// Tests de los calendarios laborales del simulador.

import { describe, expect, it } from "vitest";
import {
  addWorkingMinutes,
  defaultScenarioStart,
  defaultTimetables,
  isWorking,
  timetableIssue,
  workingMinutesBetween,
  type Timetable,
} from "./calendar";

const LV_9_17: Timetable = { id: "d", name: "L-V 9-17", beginDay: 1, endDay: 5, beginMin: 540, endMin: 1020 };
const ALL_WEEK: Timetable = { id: "247", name: "24/7", beginDay: 0, endDay: 6, beginMin: 0, endMin: 1440 };

// Lunes 5 de enero de 2026, 09:00 — origen de todos los cálculos.
const MONDAY_9AM = new Date(2026, 0, 5, 9, 0, 0);

describe("validación de horarios", () => {
  it("acepta los horarios por defecto", () => {
    for (const tt of defaultTimetables()) {
      expect(timetableIssue(tt)).toBeNull();
    }
  });

  it("rechaza una ventana de duración cero", () => {
    const issue = timetableIssue({ ...LV_9_17, beginMin: 540, endMin: 540 });
    expect(issue).toContain("misma hora");
  });

  it("rechaza un turno que cruza la medianoche", () => {
    const issue = timetableIssue({ ...LV_9_17, name: "Noche", beginMin: 1320, endMin: 360 });
    expect(issue).toContain("medianoche");
  });
});

describe("addWorkingMinutes", () => {
  it("suma directamente cuando el horario es 24/7", () => {
    expect(addWorkingMinutes(ALL_WEEK, 0, 480, MONDAY_9AM)).toBe(480);
  });

  it("se salta la noche: 4 h desde las 15:00 terminan al día siguiente", () => {
    // Empieza el lunes a las 15:00 (360 min después de las 9:00). Quedan 2 h de
    // jornada; las otras 2 h caen el martes de 9:00 a 11:00.
    const end = addWorkingMinutes(LV_9_17, 360, 240, MONDAY_9AM);

    // 360 → lunes 15:00. Martes 11:00 son 26 h después del lunes 9:00.
    expect(end).toBe(26 * 60);
  });

  it("se salta el fin de semana", () => {
    // Viernes 16:00 = 4 días + 7 h desde el lunes 9:00.
    const fridayAfternoon = 4 * 1440 + 7 * 60;
    const end = addWorkingMinutes(LV_9_17, fridayAfternoon, 120, MONDAY_9AM);

    // Queda 1 h el viernes; la otra, el lunes siguiente de 9:00 a 10:00.
    expect(end).toBe(7 * 1440 + 60);
  });

  it("no se cuelga con un turno que cruza la medianoche", () => {
    // Antes daba 100.001 vueltas (≈180 ms POR TAREA) y devolvía un instante de
    // más de un millón de días. Ahora ignora el calendario inválido.
    const night: Timetable = { ...LV_9_17, name: "Noche", beginMin: 1320, endMin: 360 };

    const t0 = Date.now();
    const end = addWorkingMinutes(night, 0, 480, MONDAY_9AM);

    expect(end).toBe(480);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it("devuelve el instante de partida si no hay trabajo que hacer", () => {
    expect(addWorkingMinutes(LV_9_17, 120, 0, MONDAY_9AM)).toBe(120);
  });
});

describe("workingMinutesBetween", () => {
  it("cuenta solo los minutos dentro de la jornada", () => {
    // Lunes 16:00 (420) → martes 10:00 (1500): 1 h el lunes y 1 h el martes.
    expect(workingMinutesBetween(LV_9_17, 7 * 60, 25 * 60, MONDAY_9AM)).toBe(120);
  });

  it("es 0 durante la noche", () => {
    // Lunes 18:00 → martes 08:00.
    expect(workingMinutesBetween(LV_9_17, 9 * 60, 23 * 60, MONDAY_9AM)).toBe(0);
  });

  it("no cuenta el fin de semana", () => {
    // Viernes 16:00 → lunes 10:00: 1 h el viernes y 1 h el lunes.
    const fridayAfternoon = 4 * 1440 + 7 * 60;
    expect(workingMinutesBetween(LV_9_17, fridayAfternoon, 7 * 1440 + 60, MONDAY_9AM)).toBe(120);
  });

  it("equivale a la diferencia de tiempos en 24/7", () => {
    expect(workingMinutesBetween(ALL_WEEK, 100, 5000, MONDAY_9AM)).toBe(4900);
  });

  it("es la operación inversa de addWorkingMinutes", () => {
    const start = 7 * 60; // lunes 16:00
    const end = addWorkingMinutes(LV_9_17, start, 600, MONDAY_9AM);

    expect(workingMinutesBetween(LV_9_17, start, end, MONDAY_9AM)).toBeCloseTo(600, 6);
  });

  it("devuelve 0 si el intervalo está vacío o invertido", () => {
    expect(workingMinutesBetween(LV_9_17, 500, 500, MONDAY_9AM)).toBe(0);
    expect(workingMinutesBetween(LV_9_17, 500, 100, MONDAY_9AM)).toBe(0);
  });
});

describe("defaultScenarioStart", () => {
  it("ancla el escenario al lunes de esa semana a las 9:00", () => {
    // Con "hoy a las 9:00" el mismo escenario daba resultados distintos según el
    // día en que se abría el panel: un sábado todo esperaba al lunes y un
    // viernes el fin de semana caía en mitad de la corrida.
    for (let day = 7; day <= 13; day++) { // lunes 7 → domingo 13 de septiembre de 2026
      const start = defaultScenarioStart(new Date(2026, 8, day, 15, 30));

      expect(start.getDay()).toBe(1);
      expect(start.getDate()).toBe(7);
      expect(start.getHours()).toBe(9);
      expect(start.getMinutes()).toBe(0);
    }
  });
});

describe("isWorking", () => {
  it("reconoce dentro y fuera de la jornada", () => {
    expect(isWorking(LV_9_17, 0, MONDAY_9AM)).toBe(true);        // lunes 09:00
    expect(isWorking(LV_9_17, 9 * 60, MONDAY_9AM)).toBe(false);  // lunes 18:00
    expect(isWorking(LV_9_17, 5 * 1440, MONDAY_9AM)).toBe(false); // sábado
  });

  it("siempre es laborable en 24/7", () => {
    expect(isWorking(ALL_WEEK, 5 * 1440, MONDAY_9AM)).toBe(true);
  });
});
