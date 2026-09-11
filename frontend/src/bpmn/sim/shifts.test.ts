// Tests del calendario de turnos con dotación variable.

import { describe, expect, it } from "vitest";
import {
  capacityAt,
  nextCapacityChange,
  personMinutesBetween,
  staffedMinutesBetween,
  type Shift,
} from "./shifts";

// Lunes 7 de septiembre de 2026, 00:00 — origen de todos los cálculos.
const MONDAY = new Date(2026, 8, 7, 0, 0, 0);
const at = (day: number, hour: number, minute = 0) => day * 1440 + hour * 60 + minute;

/** 6 personas de 6 a 14, 4 de 14 a 22 y 2 de 22 a 6, todos los días. */
const THREE_SHIFTS: Shift[] = [
  { beginDay: 0, endDay: 6, beginMin: 360, endMin: 840, capacity: 6 },
  { beginDay: 0, endDay: 6, beginMin: 840, endMin: 1320, capacity: 4 },
  { beginDay: 0, endDay: 6, beginMin: 1320, endMin: 360, capacity: 2 },
];

/** Solo noches de lunes a viernes, de 22:00 a 6:00. */
const WEEKDAY_NIGHTS: Shift[] = [{ beginDay: 1, endDay: 5, beginMin: 1320, endMin: 360, capacity: 1 }];

describe("capacityAt", () => {
  it("devuelve la dotación de cada turno", () => {
    expect(capacityAt(THREE_SHIFTS, at(0, 7), MONDAY)).toBe(6);
    expect(capacityAt(THREE_SHIFTS, at(0, 15), MONDAY)).toBe(4);
    expect(capacityAt(THREE_SHIFTS, at(0, 23), MONDAY)).toBe(2);
    expect(capacityAt(THREE_SHIFTS, at(1, 3), MONDAY)).toBe(2); // madrugada del martes
  });

  it("aplica el turno nocturno al día siguiente de su inicio", () => {
    expect(capacityAt(WEEKDAY_NIGHTS, at(4, 23), MONDAY)).toBe(1); // viernes 23:00
    expect(capacityAt(WEEKDAY_NIGHTS, at(5, 5), MONDAY)).toBe(1);  // sábado 05:00, empezó el viernes
    expect(capacityAt(WEEKDAY_NIGHTS, at(5, 23), MONDAY)).toBe(0); // sábado 23:00: no empieza turno
    expect(capacityAt(WEEKDAY_NIGHTS, at(0, 3), MONDAY)).toBe(0);  // lunes 03:00: el domingo no hubo turno
  });

  it("toma el inicio como incluido y el final como excluido", () => {
    expect(capacityAt(THREE_SHIFTS, at(0, 14), MONDAY)).toBe(4);
    expect(capacityAt(WEEKDAY_NIGHTS, at(1, 6), MONDAY)).toBe(0);
  });
});

describe("nextCapacityChange", () => {
  it("encuentra el siguiente relevo", () => {
    expect(nextCapacityChange(THREE_SHIFTS, at(0, 7), MONDAY)).toBe(at(0, 14));
    expect(nextCapacityChange(THREE_SHIFTS, at(0, 23), MONDAY)).toBe(at(1, 6));
  });

  it("salta los relevos que no cambian la dotación", () => {
    const same: Shift[] = [
      { beginDay: 0, endDay: 6, beginMin: 360, endMin: 840, capacity: 3 },
      { beginDay: 0, endDay: 6, beginMin: 840, endMin: 360, capacity: 3 },
    ];
    expect(nextCapacityChange(same, at(0, 7), MONDAY)).toBe(Infinity);
  });

  it("cruza el fin de semana", () => {
    // Desde el sábado 07:00 el siguiente turno empieza el lunes a las 22:00.
    expect(nextCapacityChange(WEEKDAY_NIGHTS, at(5, 7), MONDAY)).toBe(at(7, 22));
  });
});

describe("minutos con personal y personas-minuto", () => {
  it("cuenta solo los minutos con alguien en turno", () => {
    // Lunes 20:00 → martes 08:00 con noches L-V: de 22:00 a 06:00 (8 h).
    expect(staffedMinutesBetween(WEEKDAY_NIGHTS, at(0, 20), at(1, 8), MONDAY)).toBe(480);
  });

  it("pondera cada minuto por las personas en turno", () => {
    // Lunes 12:00 → 16:00: 2 h con 6 personas y 2 h con 4.
    expect(personMinutesBetween(THREE_SHIFTS, at(0, 12), at(0, 16), MONDAY)).toBe(2 * 60 * 6 + 2 * 60 * 4);
  });

  it("devuelve 0 en un intervalo vacío", () => {
    expect(staffedMinutesBetween(THREE_SHIFTS, 100, 100, MONDAY)).toBe(0);
    expect(personMinutesBetween(THREE_SHIFTS, 100, 50, MONDAY)).toBe(0);
  });
});
