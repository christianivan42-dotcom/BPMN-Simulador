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

/** Problema detectado en un horario, o null si es válido. */
export function timetableIssue(tt: Timetable): string | null {
  const begin = Number(tt.beginMin);
  const end = Number(tt.endMin);
  if (!Number.isFinite(begin) || !Number.isFinite(end)) {
    return `El horario "${tt.name}" tiene horas inválidas.`;
  }
  if (end === begin) {
    return `El horario "${tt.name}" abre y cierra a la misma hora (ventana de 0 minutos).`;
  }
  if (end < begin) {
    return (
      `El horario "${tt.name}" cierra (${minLabel(end)}) antes de abrir (${minLabel(begin)}). ` +
      "Para un turno que cruza la medianoche, configura el recurso con «Turnos»."
    );
  }
  return null;
}

function minLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Devuelve un horario utilizable por el motor.
 *
 * Una ventana vacía o invertida (p. ej. 22:00 → 06:00) hacía que
 * `addWorkingMinutes` no encontrara nunca minutos hábiles: agotaba su guarda de
 * 100 000 iteraciones por cada ejecución de tarea —congelando la pestaña— y
 * devolvía tiempos absurdos. Ante una configuración así se ignora el calendario
 * (equivale a 24/7) y `timetableIssue` permite avisar al usuario.
 */
function usable(tt: Timetable): Timetable {
  if (timetableIssue(tt) !== null) {
    return { ...tt, beginDay: 0, endDay: 6, beginMin: 0, endMin: 1440 };
  }
  return tt;
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
export function isWorking(rawTt: Timetable, absMin: number, base: Date): boolean {
  const tt = usable(rawTt);
  if (isAllWeek(tt)) return true;
  const { dow, minOfDay } = wall(absMin, base);
  return dayInRange(tt, dow) && minOfDay >= tt.beginMin && minOfDay < tt.endMin;
}

/**
 * Suma `workMin` minutos de trabajo a partir de `startAbs`, saltando las horas
 * fuera de horario. Devuelve el instante absoluto (reloj de pared) en que se
 * completó ese trabajo. Para 24/7 es simplemente startAbs + workMin.
 */
export function addWorkingMinutes(rawTt: Timetable, startAbs: number, workMin: number, base: Date): number {
  const tt = usable(rawTt);
  if (isAllWeek(tt) || !(workMin > 0)) return startAbs + Math.max(0, workMin || 0);

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
      const next = nextWorkStart(tt, t, base);
      if (!(next > t)) {
        // No hay progreso posible: en vez de girar en vacío, se completa el
        // trabajo restante sin calendario.
        return t + remaining;
      }
      t = next;
    }
  }
  // Si se agotó la guarda, no se devuelve un instante a medias.
  return remaining > 1e-9 ? t + remaining : t;
}

/** Próximo instante (absoluto) en que abre el horario laboral. */
export function nextWorkStart(rawTt: Timetable, absMin: number, base: Date): number {
  const tt = usable(rawTt);
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

/**
 * Minutos hábiles entre dos instantes absolutos de la simulación.
 *
 * Es la operación inversa de `addWorkingMinutes`: sirve para medir en tiempo
 * hábil una espera o la ocupación de un recurso sin contar noches ni fines de
 * semana.
 */
export function workingMinutesBetween(rawTt: Timetable, fromAbs: number, toAbs: number, base: Date): number {
  if (!(toAbs > fromAbs)) return 0;
  const tt = usable(rawTt);
  if (isAllWeek(tt)) return toAbs - fromAbs;

  let t = fromAbs;
  let total = 0;
  let guard = 0;
  while (t < toAbs && guard++ < 100000) {
    const { dow, minOfDay } = wall(t, base);
    if (dayInRange(tt, dow) && minOfDay >= tt.beginMin && minOfDay < tt.endMin) {
      const step = Math.min(toAbs - t, tt.endMin - minOfDay);
      total += step;
      t += step;
    } else {
      const next = nextWorkStart(tt, t, base);
      if (!(next > t)) break; // sin progreso posible: no quedan minutos hábiles
      t = next;
    }
  }
  return total;
}

/**
 * Inicio por defecto de un escenario: el lunes de la semana de `now`, a las 9:00.
 *
 * Con "hoy a las 9:00" el mismo escenario daba resultados distintos según el día
 * en que se abría el panel, porque las noches y el fin de semana caían en otro
 * punto de la corrida.
 */
export function defaultScenarioStart(now: Date = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
  const sinceMonday = (d.getDay() + 6) % 7; // lunes 0 … domingo 6
  d.setDate(d.getDate() - sinceMonday);
  return d;
}
