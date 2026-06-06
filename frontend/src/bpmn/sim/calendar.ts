// ── Calendarios / horarios de trabajo (timetables) ───────────────────────────
// Un timetable define una ventana laboral semanal (día inicio→fin, hora
// inicio→fin). El motor "estira" la duración de las tareas a través de las
// ventanas laborales: si una tarea empieza al final del día, continúa al
// siguiente día hábil. Así el cycle time "reloj de pared" incluye noches y
// fines de semana, mientras que el tiempo de proceso sólo cuenta horas hábiles.

export interface Timetable {
  id: string;
  name: string;
  /** 0 = Domingo … 6 = Sábado. */
  beginDay: number;
  endDay: number;
  /** Minutos desde medianoche (p. ej. 9:00 = 540). */
  beginMin: number;
  endMin: number;
}

/** Timetables por defecto. */
export function defaultTimetables(): Timetable[] {
  return [
    { id: "default", name: "Por defecto (L-V 9-17)", beginDay: 1, endDay: 5, beginMin: 540, endMin: 1020 },
    { id: "247", name: "24/7", beginDay: 0, endDay: 6, beginMin: 0, endMin: 1440 },
  ];
}

function isAllWeek(tt: Timetable): boolean {
  return tt.beginDay === 0 && tt.endDay === 6 && tt.beginMin === 0 && tt.endMin >= 1440;
}

/** ¿La ventana cubre todos los días de la semana (L-D)? */
function dayInRange(tt: Timetable, dow: number): boolean {
  if (tt.beginDay <= tt.endDay) return dow >= tt.beginDay && dow <= tt.endDay;
  // rango que cruza el domingo (p. ej. Vie→Lun)
  return dow >= tt.beginDay || dow <= tt.endDay;
}

const MS_PER_MIN = 60000;

/** Día de la semana (0-6) y minuto del día para un instante absoluto de sim. */
function wall(absMin: number, base: Date): { dow: number; minOfDay: number } {
  const d = new Date(base.getTime() + absMin * MS_PER_MIN);
  return { dow: d.getDay(), minOfDay: d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 };
}

/** ¿Está dentro del horario laboral en ese instante? */
export function isWorking(tt: Timetable, absMin: number, base: Date): boolean {
  if (isAllWeek(tt)) return true;
  const { dow, minOfDay } = wall(absMin, base);
  return dayInRange(tt, dow) && minOfDay >= tt.beginMin && minOfDay < tt.endMin;
}

/**
 * Suma `workMin` minutos de trabajo a partir de `startAbs`, saltando las horas
 * fuera de horario. Devuelve el instante absoluto (reloj de pared) en que se
 * completó ese trabajo. Para 24/7 es simplemente startAbs + workMin.
 */
export function addWorkingMinutes(tt: Timetable, startAbs: number, workMin: number, base: Date): number {
  if (isAllWeek(tt) || workMin <= 0) return startAbs + Math.max(0, workMin);

  let t = startAbs;
  let remaining = workMin;
  let guard = 0;
  while (remaining > 1e-9 && guard++ < 100000) {
    const { dow, minOfDay } = wall(t, base);
    const working = dayInRange(tt, dow) && minOfDay >= tt.beginMin && minOfDay < tt.endMin;
    if (working) {
      const minsLeftToday = tt.endMin - minOfDay; // minutos hábiles que quedan hoy
      const consume = Math.min(remaining, minsLeftToday);
      t += consume;
      remaining -= consume;
    } else {
      // saltar al próximo inicio de ventana
      t = nextWorkStart(tt, t, base);
    }
  }
  return t;
}

/** Próximo instante (absoluto) en que abre el horario laboral. */
export function nextWorkStart(tt: Timetable, absMin: number, base: Date): number {
  if (isAllWeek(tt)) return absMin;
  let t = absMin;
  let guard = 0;
  while (guard++ < 14) {
    const { dow, minOfDay } = wall(t, base);
    if (dayInRange(tt, dow)) {
      if (minOfDay < tt.beginMin) return t + (tt.beginMin - minOfDay);
      if (minOfDay < tt.endMin) return t; // ya está dentro
    }
    // avanzar al inicio del día siguiente
    const toMidnight = 1440 - minOfDay;
    t += toMidnight + tt.beginMin;
  }
  return t;
}
