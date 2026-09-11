// ── Turnos de trabajo con dotación variable ──────────────────────────────────
// Un recurso con turnos cambia de capacidad a lo largo del día: p. ej. 6 personas
// de 6:00 a 14:00, 4 de 14:00 a 22:00 y 2 de 22:00 a 6:00. Un turno puede cruzar
// la medianoche. Un horario simple (calendar.ts) es una sola franja con capacidad
// fija; con turnos la capacidad pasa a ser función del instante.

export interface Shift {
  /** Días en que EMPIEZA el turno, rango inclusivo (0 = domingo … 6 = sábado). */
  beginDay: number;
  endDay: number;
  /** Minutos desde medianoche. Si endMin <= beginMin, el turno acaba al día siguiente. */
  beginMin: number;
  endMin: number;
  /** Personas disponibles durante el turno. */
  capacity: number;
}

const MS_PER_MIN = 60_000;
const DAY = 1440;
const EPS = 1e-7;

/** Día de la semana y minuto del día de un instante de simulación.
 *  Se redondea a milisegundos: sin eso, un instante calculado como 16:59:59.9999
 *  por error de coma flotante caería en el lado equivocado de un cambio de turno. */
function wall(absMin: number, base: Date): { dow: number; minOfDay: number } {
  const d = new Date(Math.round(base.getTime() + absMin * MS_PER_MIN));
  return {
    dow: d.getDay(),
    minOfDay: d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / MS_PER_MIN,
  };
}

function startsOn(s: Shift, dow: number): boolean {
  return s.beginDay <= s.endDay
    ? dow >= s.beginDay && dow <= s.endDay
    : dow >= s.beginDay || dow <= s.endDay;
}

const crossesMidnight = (s: Shift) => s.endMin <= s.beginMin;

/** Personas del turno, saneadas (vacío o negativo = 0). */
export const headcount = (s: Shift) => Math.max(0, Math.floor(Number(s.capacity)) || 0);

/** Personas en turno en un instante (los turnos que se solapan se suman). */
export function capacityAt(shifts: Shift[], absMin: number, base: Date): number {
  const { dow, minOfDay } = wall(absMin, base);
  const yesterday = (dow + 6) % 7;
  let total = 0;
  for (const s of shifts) {
    const on = crossesMidnight(s)
      ? (startsOn(s, dow) && minOfDay >= s.beginMin) || (startsOn(s, yesterday) && minOfDay < s.endMin)
      : startsOn(s, dow) && minOfDay >= s.beginMin && minOfDay < s.endMin;
    if (on) total += headcount(s);
  }
  return total;
}

/** Minuto de simulación de una hora local concreta. Se construye con la fecha
 *  local para que el cambio de hora de verano no desplace los turnos. */
function localInstant(base: Date, year: number, month: number, day: number, minutes: number): number {
  const ms = new Date(year, month, day, Math.floor(minutes / 60), minutes % 60, 0, 0).getTime();
  return (ms - base.getTime()) / MS_PER_MIN;
}

/** Próximo instante posterior a `absMin` en que cambia la dotación, o Infinity. */
export function nextCapacityChange(shifts: Shift[], absMin: number, base: Date): number {
  const d = new Date(Math.round(base.getTime() + absMin * MS_PER_MIN));
  const year = d.getFullYear();
  const month = d.getMonth();
  const date = d.getDate();
  const current = capacityAt(shifts, absMin, base);

  // La dotación solo cambia al empezar o acabar un turno. Con mirar de ayer a
  // dentro de ocho días se cubre cualquier patrón semanal.
  const candidates: number[] = [];
  for (let k = -1; k <= 8; k++) {
    for (const s of shifts) {
      candidates.push(localInstant(base, year, month, date + k, s.beginMin));
      candidates.push(localInstant(base, year, month, date + k, s.endMin + (crossesMidnight(s) ? DAY : 0)));
    }
  }
  candidates.sort((a, b) => a - b);
  for (const c of candidates) {
    if (c > absMin + EPS && capacityAt(shifts, c, base) !== current) return c;
  }
  return Infinity;
}

/** Recorre [from, to) por tramos de dotación constante. */
function eachSegment(
  shifts: Shift[], from: number, to: number, base: Date,
  visit: (capacity: number, minutes: number) => void,
): void {
  let t = from;
  let guard = 0;
  while (t < to - EPS && guard++ < 100_000) {
    const next = Math.min(to, nextCapacityChange(shifts, t, base));
    visit(capacityAt(shifts, t, base), next - t);
    if (!(next > t)) break;
    t = next;
  }
}

/** Minutos de [from, to) en que hay al menos una persona en turno. */
export function staffedMinutesBetween(shifts: Shift[], from: number, to: number, base: Date): number {
  let total = 0;
  eachSegment(shifts, from, to, base, (capacity, minutes) => {
    if (capacity > 0) total += minutes;
  });
  return total;
}

/** Personas-minuto disponibles en [from, to): la base de la utilización. */
export function personMinutesBetween(shifts: Shift[], from: number, to: number, base: Date): number {
  let total = 0;
  eachSegment(shifts, from, to, base, (capacity, minutes) => {
    total += capacity * minutes;
  });
  return total;
}
