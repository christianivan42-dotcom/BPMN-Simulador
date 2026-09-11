// Tests de las distribuciones de probabilidad.
//
// Con semilla fija y muchas muestras, comprueban que cada generador produce la
// media y la desviación que promete. Un error de parametrización (p. ej. usar la
// varianza donde va la desviación) desplazaría todos los tiempos simulados.

import { describe, expect, it } from "vitest";
import { expectedValue, makeRng, sample, type Distribution } from "./distributions";

const N = 50_000;

function moments(d: Distribution, seed = 2026): { mean: number; std: number; min: number } {
  const rng = makeRng(seed);
  let sum = 0;
  let sq = 0;
  let min = Infinity;
  for (let i = 0; i < N; i++) {
    const x = sample(d, rng);
    sum += x;
    sq += x * x;
    if (x < min) min = x;
  }
  const mean = sum / N;
  return { mean, std: Math.sqrt(Math.max(0, sq / N - mean * mean)), min };
}

/** Diferencia relativa por debajo de la tolerancia. */
function near(actual: number, expected: number, tolerance: number) {
  expect(Math.abs(actual - expected) / expected).toBeLessThan(tolerance);
}

describe("muestreo: media y desviación", () => {
  const cases: Array<[string, Distribution, number, number]> = [
    ["exponencial", { kind: "exponential", mean: 10 }, 10, 10],
    ["normal", { kind: "normal", mean: 10, std: 2 }, 10, 2],
    ["uniforme", { kind: "uniform", mean: 0, min: 5, max: 15 }, 10, 10 / Math.sqrt(12)],
    ["triangular", { kind: "triangular", mean: 0, min: 2, mode: 5, max: 11 }, 6, Math.sqrt(3.5)],
    ["lognormal", { kind: "lognormal", mean: 10, std: 4 }, 10, 4],
    ["gamma (forma > 1)", { kind: "gamma", mean: 10, std: 4 }, 10, 4],
    ["gamma (forma < 1)", { kind: "gamma", mean: 2, std: 4 }, 2, 4],
  ];

  for (const [label, dist, mean, std] of cases) {
    it(`${label}: media ${mean}, desviación ${std.toFixed(2)}`, () => {
      const m = moments(dist);
      near(m.mean, mean, 0.03);
      near(m.std, std, 0.06);
    });
  }

  it("nunca devuelve tiempos negativos", () => {
    // Una normal muy dispersa cae por debajo de 0 a menudo: se trunca.
    expect(moments({ kind: "normal", mean: 2, std: 5 }).min).toBeGreaterThanOrEqual(0);
  });

  it("la fija devuelve siempre el mismo valor", () => {
    const m = moments({ kind: "fixed", mean: 7 });

    expect(m.mean).toBe(7);
    expect(m.std).toBeCloseTo(0, 6);
  });
});

describe("expectedValue", () => {
  it("usa mínimo y máximo en la uniforme aunque la media esté a 0", () => {
    // El panel descartaba las demoras con media 0, y en la uniforme la media no
    // se rellena: una espera "entre 2 y 4 días" se ignoraba sin avisar.
    expect(expectedValue({ kind: "uniform", mean: 0, min: 2880, max: 5760 })).toBe(4320);
  });

  it("usa mínimo, moda y máximo en la triangular", () => {
    expect(expectedValue({ kind: "triangular", mean: 0, min: 1, mode: 2, max: 6 })).toBe(3);
  });

  it("usa la media en el resto de distribuciones", () => {
    expect(expectedValue({ kind: "normal", mean: 10, std: 2 })).toBe(10);
    expect(expectedValue({ kind: "fixed", mean: 0 })).toBe(0);
  });
});
