// ── Acceso seguro a localStorage ─────────────────────────────────────────────
// Los diagramas BPMN viven en localStorage. Antes cada escritura iba envuelta en
// `try { ... } catch { /* ignore */ }`, así que cuando fallaba —cuota llena,
// navegación privada, cookies de terceros bloqueadas— el usuario seguía viendo
// "Guardado ✓" mientras perdía el trabajo. Aquí el fallo se DEVUELVE para que la
// interfaz pueda avisar.

/** Resultado de un intento de guardado, venga del navegador o del backend. */
export type SaveOutcome = { ok: true } | { ok: false; message: string };

export type StorageResult =
  | { ok: true }
  | { ok: false; reason: "quota" | "unavailable"; message: string };

/** ¿Está localStorage realmente disponible y escribible? */
export function storageAvailable(): boolean {
  try {
    const probe = "__bpms_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Cada navegador la nombra distinto; Safari en privado usa código 22.
  const name = err.name;
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    (err as unknown as { code?: number }).code === 22
  );
}

export function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): StorageResult {
  try {
    window.localStorage.setItem(key, value);
    return { ok: true };
  } catch (err) {
    if (isQuotaError(err)) {
      return {
        ok: false,
        reason: "quota",
        message:
          "El almacenamiento del navegador está lleno. Descarga el diagrama (.bpmn) " +
          "y borra procesos que ya no uses para liberar espacio.",
      };
    }
    return {
      ok: false,
      reason: "unavailable",
      message:
        "El navegador está bloqueando el almacenamiento local (¿ventana privada o " +
        "cookies bloqueadas?). Descarga el diagrama (.bpmn) para no perderlo.",
    };
  }
}

export function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* si no se puede borrar, no hay nada que hacer */
  }
}

/** Tamaño aproximado en bytes de todo lo que guarda la app (claves `bpms_`/`expert_`). */
export function approximateUsage(): number {
  let total = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      total += k.length + (window.localStorage.getItem(k)?.length ?? 0);
    }
  } catch {
    return 0;
  }
  return total * 2; // UTF-16: ~2 bytes por carácter
}
