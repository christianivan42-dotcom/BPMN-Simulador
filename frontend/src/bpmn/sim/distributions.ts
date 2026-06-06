// ── Distribuciones de probabilidad para tiempos de proceso/llegada ───────────
// Todos los tiempos se manejan en MINUTOS internamente.

export type DistributionKind =
  | "fixed"
  | "exponential"
  | "normal"
  | "uniform"
  | "triangular"
  | "lognormal"
  | "gamma";

export interface Distribution {
  kind: DistributionKind;
  /** Media / valor constante (min). Para exponencial = media. */
  mean: number;
  /** Desviación estándar (normal). */
  std?: number;
  /** Mínimo (uniform / triangular). */
  min?: number;
  /** Máximo (uniform / triangular). */
  max?: number;
  /** Moda (triangular). */
  mode?: number;
}

export function fixed(mean: number): Distribution {
  return { kind: "fixed", mean };
}

/** PRNG determinista (mulberry32) para que una corrida sea reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller para normal estándar. */
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Muestra Gamma(shape k, scale θ) — método Marsaglia-Tsang. */
function gammaSample(k: number, theta: number, rng: () => number): number {
  if (k < 1) {
    const u = Math.max(rng(), 1e-9);
    return gammaSample(k + 1, theta, rng) * Math.pow(u, 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = gaussian(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.max(rng(), 1e-9);
    if (u < 1 - 0.0331 * x * x * x * x) return d * v * theta;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * theta;
  }
}

/** Devuelve una muestra (>= 0) de la distribución, en minutos. */
export function sample(d: Distribution, rng: () => number): number {
  let x: number;
  switch (d.kind) {
    case "fixed":
      x = d.mean;
      break;
    case "exponential": {
      const lambda = d.mean > 0 ? 1 / d.mean : 0;
      const u = Math.max(rng(), 1e-9);
      x = lambda > 0 ? -Math.log(u) / lambda : 0;
      break;
    }
    case "normal": {
      const std = d.std ?? Math.max(d.mean * 0.2, 0.0001);
      x = d.mean + gaussian(rng) * std;
      break;
    }
    case "uniform": {
      const lo = d.min ?? Math.max(d.mean * 0.5, 0);
      const hi = d.max ?? d.mean * 1.5;
      x = lo + rng() * (hi - lo);
      break;
    }
    case "triangular": {
      const lo = d.min ?? Math.max(d.mean * 0.5, 0);
      const hi = d.max ?? d.mean * 1.5;
      const mode = d.mode ?? d.mean;
      const u = rng();
      const fc = (mode - lo) / (hi - lo || 1);
      x =
        u < fc
          ? lo + Math.sqrt(u * (hi - lo) * (mode - lo))
          : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
      break;
    }
    case "lognormal": {
      const m = Math.max(d.mean, 1e-9);
      const s = d.std ?? Math.max(d.mean * 0.25, 0.0001);
      const sigma2 = Math.log(1 + (s * s) / (m * m));
      const mu = Math.log(m) - sigma2 / 2;
      x = Math.exp(mu + Math.sqrt(sigma2) * gaussian(rng));
      break;
    }
    case "gamma": {
      const m = Math.max(d.mean, 1e-9);
      const s = d.std ?? Math.max(d.mean * 0.25, 0.0001);
      const variance = s * s;
      const shape = (m * m) / variance;
      const scale = variance / m;
      x = gammaSample(shape, scale, rng);
      break;
    }
    default:
      x = d.mean;
  }
  return Math.max(0, x);
}

export function describeDistribution(d: Distribution): string {
  switch (d.kind) {
    case "fixed":
      return `fija ${d.mean} min`;
    case "exponential":
      return `exp(μ=${d.mean} min)`;
    case "normal":
      return `normal(μ=${d.mean}, σ=${d.std ?? "—"})`;
    case "uniform":
      return `uniforme[${d.min ?? "?"}, ${d.max ?? "?"}]`;
    case "triangular":
      return `triang(${d.min ?? "?"}, ${d.mode ?? d.mean}, ${d.max ?? "?"})`;
    case "lognormal":
      return `lognormal(μ=${d.mean}, σ=${d.std ?? "—"})`;
    case "gamma":
      return `gamma(μ=${d.mean}, σ=${d.std ?? "—"})`;
  }
}

export const DISTRIBUTION_LABELS: Record<DistributionKind, string> = {
  fixed: "Fija (constante)",
  exponential: "Exponencial",
  normal: "Normal",
  uniform: "Uniforme",
  triangular: "Triangular",
  lognormal: "Log-Normal",
  gamma: "Gamma",
};

/** Qué parámetros (campos) requiere cada distribución, para construir el editor. */
export type DistParam = "mean" | "std" | "min" | "max" | "mode";
export const DISTRIBUTION_PARAMS: Record<DistributionKind, DistParam[]> = {
  fixed: ["mean"],
  exponential: ["mean"],
  normal: ["mean", "std"],
  uniform: ["min", "max"],
  triangular: ["min", "mode", "max"],
  lognormal: ["mean", "std"],
  gamma: ["mean", "std"],
};
export const PARAM_LABELS: Record<DistParam, string> = {
  mean: "Media",
  std: "Desv. est.",
  min: "Mín",
  max: "Máx",
  mode: "Moda",
};
