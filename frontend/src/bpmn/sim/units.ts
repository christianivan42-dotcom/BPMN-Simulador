// ── Unidades de tiempo (segundos/minutos/horas/días) ─────────────────────────
// Internamente el motor trabaja SIEMPRE en minutos; aquí se convierte.

export type TimeUnit = "seconds" | "minutes" | "hours" | "days";

export const TIME_UNIT_LABELS: Record<TimeUnit, string> = {
  seconds: "Segundos",
  minutes: "Minutos",
  hours: "Horas",
  days: "Días",
};

/** Factor de conversión: 1 unidad = X minutos. */
export const UNIT_TO_MIN: Record<TimeUnit, number> = {
  seconds: 1 / 60,
  minutes: 1,
  hours: 60,
  days: 1440,
};

export function toMinutes(value: number, unit: TimeUnit): number {
  return value * UNIT_TO_MIN[unit];
}

export function fromMinutes(min: number, unit: TimeUnit): number {
  return min / UNIT_TO_MIN[unit];
}
