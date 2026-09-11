// ─────────────────────────────────────────────────────────────────────────────
// Genera las capturas de pantalla del manual de usuario (docs/img/*.jpg).
//
// Recorre la aplicación como lo haría un analista: carga una organización de
// ejemplo, abre el AS-IS del proceso de crédito, rellena los datos de la
// simulación, pide el diagnóstico a la IA, simula el TO-BE y pide el veredicto.
// Los datos son los mismos que explica docs/MANUAL.md.
//
// Requisitos: backend (puerto 8010) y frontend (puerto 5173) en marcha.
//   cd scripts/capturas
//   npm run setup        # una sola vez: instala Playwright y Chromium
//   npm run capturas     # o: node capturas.mjs [--force] [--headed]
//
// ⚠ Sustituye la organización y los diagramas de la base de datos por los del
//   ejemplo. Úsalo con una base vacía: si ya hay otra organización se detiene,
//   salvo que pases --force.
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(ROOT, "docs", "img");
const DEBUG = path.join(HERE, "debug");

const argValue = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const APP_URL = argValue("app", "http://127.0.0.1:5173");
const API_URL = `${argValue("api", "http://127.0.0.1:8010")}/api/v1`;
const FORCE = process.argv.includes("--force");
const HEADED = process.argv.includes("--headed");

const VIEWPORT = { width: 1440, height: 900 };
/** El asistente encadena proveedores con 90 s de timeout cada uno. */
const AI_TIMEOUT = 240_000;
/** Intentos por consulta a la IA y pausa entre ellos (saturación pasajera del proveedor). */
const AI_RETRIES = 4;
const AI_RETRY_WAIT = 40_000;
/** Alto máximo de las capturas verticales del panel de simulación. */
const MAX_TALL = 3600;

// ── Datos del ejemplo ────────────────────────────────────────────────────────

const ORG = {
  razon_social: "Financiera Demo S.A.",
  nombre_corto: "Financiera Demo",
  sector: "Servicios financieros",
  tamano: "mediana",
  mision: "Dar acceso a crédito de consumo justo y rápido a familias y pequeños negocios.",
  vision: "Ser en 2030 la financiera con la mejor experiencia de crédito de la región: respuesta en el mismo día.",
  valores: "Transparencia\nAgilidad\nResponsabilidad con el cliente\nMejora continua",
  estrategias: [
    "Digitalizar la originación de créditos",
    "Decidir con datos: scoring y reglas de negocio",
    "Eliminar esperas y retrabajos en los procesos clave",
  ],
  objetivos_estrategicos: [
    "Reducir el tiempo de aprobación de crédito a menos de 1 día",
    "Bajar el costo por solicitud un 30 %",
    "Aumentar la satisfacción del cliente al 90 %",
  ],
  kpis: [
    { id: "k1", nombre: "Tiempo medio de aprobación", meta: "1", unidad: "días", frecuencia: "mensual", responsable: "Gerencia de Crédito" },
    { id: "k2", nombre: "Costo por solicitud", meta: "15", unidad: "USD", frecuencia: "trimestral", responsable: "Finanzas" },
    { id: "k3", nombre: "Satisfacción del cliente", meta: "90", unidad: "%", frecuencia: "trimestral", responsable: "Experiencia de cliente" },
  ],
  poa: [
    { id: "p1", objetivo: "Reducir el tiempo de aprobación de crédito a menos de 1 día", actividad: "Simular y rediseñar el proceso de aprobación de crédito", responsable: "Oficina de procesos", periodo: "Q1", indicador: "Cycle time del proceso", meta: "< 1 día", presupuesto: "5000" },
    { id: "p2", objetivo: "Bajar el costo por solicitud un 30 %", actividad: "Implantar el scoring automático", responsable: "Tecnología", periodo: "Q2", indicador: "Costo por solicitud", meta: "−30 %", presupuesto: "20000" },
  ],
  mapa_procesos: [
    { id: "m1", nombre: "Planificación estratégica", descripcion: "Objetivos y seguimiento del POA", categoria: "estrategico" },
    { id: "m2", nombre: "Gestión de la calidad y mejora continua", descripcion: "Simulación y rediseño de procesos", categoria: "estrategico" },
    { id: "m3", nombre: "Captación de clientes", descripcion: "Marketing y canales de venta", categoria: "operativo" },
    { id: "m4", nombre: "Otorgamiento de crédito", descripcion: "Solicitud, evaluación, aprobación y desembolso", categoria: "operativo" },
    { id: "m5", nombre: "Cobranza", descripcion: "Seguimiento de pagos y recuperación", categoria: "operativo" },
    { id: "m6", nombre: "Gestión del talento", descripcion: "Selección, formación y evaluación", categoria: "apoyo" },
    { id: "m7", nombre: "Tecnología de la información", descripcion: "Sistemas, integraciones y soporte", categoria: "apoyo" },
    { id: "m8", nombre: "Finanzas y contabilidad", descripcion: "Presupuesto, tesorería y contabilidad", categoria: "apoyo" },
  ],
};
const PROCESS_NAME = "Aprobación de crédito de consumo";
const MAP_ITEM_ID = "m4";

/** Misma demanda en los dos escenarios: si no, la comparación no vale. */
const SCENARIO = { instances: 200, arrival: { kind: "exponential", mean: 45, unit: "minutes" }, currency: "USD" };

const ASIS = {
  resources: [
    { name: "Asesor comercial", capacity: 3, cost: 12 },
    { name: "Analista de riesgo", capacity: 1, cost: 25 },
    { name: "Comité de crédito", capacity: 1, cost: 90 },
  ],
  tasks: [
    { id: "Task_Registrar", name: "Registrar solicitud en el sistema", dur: { kind: "normal", mean: 20, std: 5, unit: "minutes" }, resource: "Asesor comercial" },
    { id: "Task_Verificar", name: "Verificar documentación del cliente", dur: { kind: "normal", mean: 30, std: 8, unit: "minutes" }, resource: "Asesor comercial" },
    { id: "Task_PedirDocs", name: "Solicitar documentos faltantes al cliente", dur: { kind: "normal", mean: 10, std: 3, unit: "minutes" }, resource: "Asesor comercial" },
    { id: "Task_Evaluar", name: "Evaluar riesgo crediticio manualmente", dur: { kind: "normal", mean: 40, std: 10, unit: "minutes" }, resource: "Analista de riesgo" },
    { id: "Task_Comite", name: "Aprobar en comité de crédito", dur: { kind: "normal", mean: 30, std: 5, unit: "minutes" }, resource: "Comité de crédito" },
    { id: "Task_Desembolsar", name: "Formalizar y desembolsar", dur: { kind: "normal", mean: 45, std: 10, unit: "minutes" }, resource: "Asesor comercial" },
  ],
  gateways: [
    { id: "Gw_Documentos", name: "¿Documentación completa?", weights: { No: 0.35, Sí: 0.65 } },
    { id: "Gw_Decision", name: "¿Crédito aprobado?", weights: { Sí: 0.7, No: 0.3 } },
  ],
  events: [
    { id: "Event_Documentos", name: "Documentos recibidos del cliente", delay: { kind: "triangular", min: 1, mode: 2, max: 5, unit: "days" } },
    { id: "Event_EsperaComite", name: "Esperar sesión del comité", delay: { kind: "fixed", mean: 3, unit: "days" } },
  ],
};

const TOBE = {
  resources: [{ name: "Comité de crédito", capacity: 1, cost: 90 }],
  tasks: [
    { id: "Task_AltaAuto", name: "Alta automática de la solicitud", dur: { kind: "fixed", mean: 1, unit: "minutes" }, resource: "" },
    { id: "Task_ValidarAuto", name: "Validar documentación automáticamente", dur: { kind: "fixed", mean: 2, unit: "minutes" }, resource: "", fixedCost: 0.3 },
    { id: "Task_Notificar", name: "Notificar al cliente que faltan documentos", dur: { kind: "fixed", mean: 1, unit: "minutes" }, resource: "" },
    { id: "Task_Scoring", name: "Scoring crediticio automático", dur: { kind: "fixed", mean: 1, unit: "minutes" }, resource: "", fixedCost: 0.5 },
    { id: "Task_Comite", name: "Revisar en comité (solo riesgo alto)", dur: { kind: "normal", mean: 30, std: 5, unit: "minutes" }, resource: "Comité de crédito" },
    { id: "Task_AprobacionAuto", name: "Aprobación automática por scoring", dur: { kind: "fixed", mean: 1, unit: "minutes" }, resource: "" },
    { id: "Task_Desembolsar", name: "Formalizar y desembolsar en línea", dur: { kind: "fixed", mean: 5, unit: "minutes" }, resource: "" },
  ],
  gateways: [
    { id: "Gw_Documentos", name: "¿Documentación completa?", weights: { No: 0.1, Sí: 0.9 } },
    { id: "Gw_Riesgo", name: "¿Riesgo alto?", weights: { Sí: 0.25, No: 0.75 } },
  ],
  events: [],
};

/** Recurso por turnos que solo se usa para mostrar el editor de turnos. */
const SHIFT_DEMO = { name: "Centro de contacto 24/7", capacity: 3, cost: 10, people: [3, 3, 2] };

// ── API del backend ──────────────────────────────────────────────────────────

async function api(pathname, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${pathname}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`No se pudo contactar con el backend en ${API_URL}. ¿Está corriendo?`);
  }
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text && text !== "null" ? JSON.parse(text) : null;
}

async function seed() {
  const [asisXml, tobeXml] = await Promise.all([
    readFile(path.join(ROOT, "docs", "ejemplos", "credito-asis.bpmn"), "utf8"),
    readFile(path.join(ROOT, "docs", "ejemplos", "credito-tobe.bpmn"), "utf8"),
  ]);

  let company = await api("/companies/primera");
  if (company && company.razon_social !== ORG.razon_social && !FORCE) {
    throw new Error(
      `La base de datos ya tiene la organización «${company.razon_social}». Este script la reemplaza ` +
      "por la del ejemplo: usa una base vacía o añade --force.",
    );
  }
  company ??= await api("/companies", { method: "POST", body: { razon_social: ORG.razon_social } });
  await api(`/companies/${company.id}`, { method: "PATCH", body: ORG });

  for (const d of await api(`/bpmn-diagrams?company_id=${encodeURIComponent(company.id)}`)) {
    await api(`/bpmn-diagrams/${d.id}`, { method: "DELETE" });
  }
  await api("/bpmn-diagrams", {
    method: "POST",
    body: { company_id: company.id, name: PROCESS_NAME, map_item_id: MAP_ITEM_ID, asis_xml: asisXml, tobe_xml: tobeXml },
  });
  console.log(`Datos de ejemplo cargados en «${ORG.razon_social}».`);
}

// ── Utilidades de la interfaz ────────────────────────────────────────────────

/** @type {import("playwright").Page} */
let page;

const step = (title) => console.log(`\n▸ ${title}`);
const settle = (ms = 500) => page.waitForTimeout(ms);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exact = (text) => new RegExp(`^\\s*${escapeRe(text)}\\s*$`);

async function shot(name, target = page) {
  await target.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 85 });
  console.log(`  ✓ docs/img/${name}.jpg`);
}

const goModule = (label) => page.locator(".shell-sidebar-item", { hasText: label }).click();
const waitShape = (id) => page.locator(`.djs-element[data-element-id="${id}"]`).first().waitFor({ timeout: 30_000 });
const panel = () => page.locator(".sim-panel");
const dock = () => page.locator(".bpmn-sim-dock");
const section = (title) => panel().locator(".sim-sec").filter({ has: page.locator("h4", { hasText: title }) });
const inlineField = (scope, label) =>
  scope.locator("label.sim-inline").filter({ has: page.locator("span", { hasText: exact(label) }) }).first();
const scrollPanelTop = () => panel().locator(".sim-scroll").evaluate((el) => { el.scrollTop = 0; });

/** «Ajustar vista» y un paso de zoom hacia fuera: la paleta tapaba el evento de inicio. */
async function fitDiagram() {
  await page.locator('button[title="Ajustar vista"]').click();
  await settle(300);
  const box = await page.locator(".bpmn-canvas-area").boundingBox();
  if (!box) return;
  // Con el borde derecho como centro del zoom, el diagrama se aparta de la paleta.
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 120);
  await page.keyboard.up("Control");
  await settle(400);
}

/** Clic en una zona vacía del lienzo: quita la selección y cierra el editor del elemento. */
async function clickEmptyCanvas() {
  const box = await page.locator(".bpmn-canvas-area").boundingBox();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height - 30);
  await settle(300);
}

async function enterFullscreen() {
  await page.locator('button[title="Pantalla completa"]').click();
  await settle(400);
}
async function exitFullscreen() {
  await page.locator('button[title^="Salir de pantalla completa"]').click();
  await settle(400);
}

async function openSimulator() {
  await page.locator(".bpmn-tb-btn-sim").click();
  await panel().waitFor();
  await settle(600);
  await fitDiagram();
}

/** Captura el panel entero, estirando la ventana para que no quede nada oculto. */
async function shotDock(name) {
  await scrollPanelTop();
  const needed = await panel().locator(".sim-scroll").evaluate(
    (el) => Math.ceil(el.getBoundingClientRect().top + el.scrollHeight + 24),
  );
  await page.setViewportSize({ width: VIEWPORT.width, height: Math.min(Math.max(VIEWPORT.height, needed), MAX_TALL) });
  await settle(500);
  await scrollPanelTop();
  await shot(name, dock());
  await page.setViewportSize(VIEWPORT);
  await settle(400);
}

/** Captura un elemento del panel más alto que la ventana. */
async function shotTall(name, locator) {
  const height = await locator.evaluate((el) => el.getBoundingClientRect().height);
  const top = await panel().locator(".sim-scroll").evaluate((el) => el.getBoundingClientRect().top);
  await page.setViewportSize({ width: VIEWPORT.width, height: Math.min(Math.max(VIEWPORT.height, Math.ceil(top + height + 40)), MAX_TALL) });
  await settle(500);
  await locator.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await settle(200);
  await shot(name, locator);
  await page.setViewportSize(VIEWPORT);
  await settle(400);
}

/** Selecciona un elemento haciendo clic en el diagrama; si el clic no llega, desde la lista del panel. */
async function selectElement(id, name, listTitle) {
  const title = panel().locator(".sim-selected-card .sim-selected-name");
  try {
    await page.locator(`.djs-element[data-element-id="${id}"]`).first().click({ timeout: 4_000 });
    await title.filter({ hasText: name }).waitFor({ timeout: 2_000 });
  } catch {
    await section(listTitle).locator(".sim-list-row", { hasText: name }).first().click();
    await title.filter({ hasText: name }).waitFor({ timeout: 5_000 });
  }
  await scrollPanelTop();
}

async function setDist(scope, d) {
  const dist = scope.locator(".sim-dist").first();
  await dist.locator('select[title="distribución"]').selectOption(d.kind);
  const param = (label) => dist.locator(".sim-dist-param").filter({ has: page.locator("span", { hasText: exact(label) }) }).first();
  for (const [key, label] of [["mean", "Media"], ["std", "Desv. est."], ["min", "Mín"], ["mode", "Moda"], ["max", "Máx"]]) {
    if (d[key] !== undefined) await param(label).locator("input").fill(String(d[key]));
  }
  if (d.unit) await param("Unidad").locator("select").selectOption(d.unit);
}

async function fillScenario() {
  const escenario = section("Escenario");
  await escenario.locator("label.sim-field", { hasText: "Nº de instancias" }).locator("input").fill(String(SCENARIO.instances));
  await setDist(escenario, SCENARIO.arrival);
  await escenario.locator("label.sim-field", { hasText: "Moneda" }).locator("select").selectOption(SCENARIO.currency);
}

async function addResource(r) {
  const recursos = section("Recursos");
  const index = await recursos.locator(".sim-res-block").count();
  await recursos.locator(".sim-add", { hasText: "Añadir recurso" }).click();
  const row = recursos.locator(".sim-res-block").nth(index).locator(".sim-res-row");
  await row.locator(".sim-res-name").fill(r.name);
  await row.locator('input[type="number"]').nth(0).fill(String(r.capacity));
  await row.locator('input[type="number"]').nth(1).fill(String(r.cost));
  if (r.timetable) await row.locator('select[title="horario laboral"]').selectOption(r.timetable);
  return recursos.locator(".sim-res-block").nth(index);
}

async function configureTask(t) {
  await selectElement(t.id, t.name, "Tareas");
  const card = panel().locator(".sim-selected-card");
  await setDist(card, t.dur);
  await inlineField(card, "Recurso").locator("select").selectOption(t.resource ? { label: t.resource } : { value: "" });
  if (t.fixedCost) await inlineField(card, "Costo fijo").locator("input").fill(String(t.fixedCost));
}

async function configureGateway(g) {
  await selectElement(g.id, g.name, "Compuertas");
  const card = panel().locator(".sim-selected-card");
  for (const [label, p] of Object.entries(g.weights)) {
    await card.locator(".sim-gw-row").filter({ has: page.locator("span", { hasText: exact(label) }) }).locator("input").fill(String(p));
  }
}

async function configureEvent(e) {
  await selectElement(e.id, e.name, "Eventos / esperas");
  await setDist(panel().locator(".sim-selected-card"), e.delay);
}

async function configure(model) {
  await fillScenario();
  for (const r of model.resources) await addResource(r);
  for (const t of model.tasks) await configureTask(t);
  for (const g of model.gateways) await configureGateway(g);
  for (const e of model.events) await configureEvent(e);
}

async function runSimulation() {
  await clickEmptyCanvas();
  await panel().locator(".sim-run-btn").click();
  await panel().locator(".sim-results").waitFor({ timeout: 120_000 });
}

const openTab = (label) => panel().locator(".sim-tabs button", { hasText: label }).click();

/**
 * Pulsa una acción del asistente y espera la respuesta (del modelo o calculada).
 * Si el proveedor falla (saturado, sin cuota…) el panel muestra un aviso: se
 * espera y se vuelve a pedir, para que el manual no enseñe un error pasajero.
 */
async function askIa(label) {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    await panel().locator(".sim-ia-btn", { hasText: label }).click();
    await panel().locator(".sim-ia-loading").waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
    await panel().locator(".sim-ia-loading").waitFor({ state: "detached", timeout: AI_TIMEOUT });
    const failed = (await panel().locator(".sim-ia > .sim-warn, .sim-ia-answer > .sim-warn").count()) > 0;
    const source = (await panel().locator(".sim-ia-source").count())
      ? "análisis calculado (sin modelo de lenguaje)"
      : (await panel().locator(".sim-ia-answer").count()) ? "modelo de lenguaje" : "sin respuesta";
    console.log(`    IA «${label}»: ${source}${failed ? " — el proveedor no respondió" : ""}, ${Math.round((Date.now() - started) / 1000)} s`);
    if (!failed || attempt >= AI_RETRIES) return;
    console.log(`    reintento ${attempt}/${AI_RETRIES - 1} en ${AI_RETRY_WAIT / 1000} s…`);
    await settle(AI_RETRY_WAIT);
  }
}

/** Pregunta en el AI Workspace; si el proveedor falla, borra la conversación y repite. */
async function askWorkspace() {
  for (let attempt = 1; ; attempt++) {
    await page.locator(".ai-dock-suggestion-chip").nth(1).click();
    await page.locator(".ai-dock-send-btn").click();
    await page.locator(".ai-dock-response-content, .ai-dock-error-bubble").first().waitFor({ timeout: AI_TIMEOUT });
    const failed = (await page.locator(".ai-dock-error-bubble").count()) > 0;
    console.log(`    AI Workspace: ${failed ? "el proveedor no respondió" : "respuesta del modelo"}`);
    if (!failed || attempt >= AI_RETRIES) return;
    console.log(`    reintento ${attempt}/${AI_RETRIES - 1} en ${AI_RETRY_WAIT / 1000} s…`);
    await settle(AI_RETRY_WAIT);
    await page.locator('.ai-dock-icon-btn[title="Nueva conversación"]').click();
    await page.locator(".ai-dock-confirm-yes").click();
  }
}

// ── Recorrido ────────────────────────────────────────────────────────────────

async function tour() {
  step("Inicio");
  // La primera carga de Vite compila los módulos: puede tardar bastante más de 20 s.
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator(".shell-sidebar").waitFor({ timeout: 60_000 });
  // Con el servidor recién arrancado la página sigue cargando módulos y no
  // atiende los clics: se espera a que termine.
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  await settle(1500);
  await goModule("Inicio");
  await page.locator(".org-module").waitFor();
  await settle(800);
  await shot("01-inicio-organizacion");
  await page.locator(".org-card", { hasText: "KPIs principales" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await settle();
  await shot("02-inicio-kpis-poa");

  step("Mapa de procesos");
  await goModule("Procesos");
  await page.locator(".procesos-tab", { hasText: "Mapa de procesos" }).click();
  await page.locator(".mapa-bpmn-chip").first().waitFor();
  await settle();
  await shot("03-mapa-procesos");

  step("BPMN AS-IS");
  await page.locator(".procesos-tab", { hasText: "BPMN" }).click();
  await waitShape("Task_Evaluar");
  await page.locator(".bpmn-procbar").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await settle(400);
  await fitDiagram();
  await shot("04-bpmn-asis");

  step("Simulación del AS-IS: datos");
  await enterFullscreen();
  await openSimulator();
  await shot("05-sim-panel-abierto");

  await openTab("IA");
  await askIa("Ayúdame a llenar los datos");
  await shotDock("06-ia-ayuda-datos");
  await openTab("Configuración");

  await configure(ASIS);
  await section("Escenario").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await settle();
  await shot("07-sim-escenario", dock());

  const shiftBlock = await addResource({ ...SHIFT_DEMO, timetable: "__turnos__" });
  for (const [k, n] of SHIFT_DEMO.people.entries()) {
    await shiftBlock.locator(".sim-shift-row").nth(k).locator('input[type="number"]').fill(String(n));
  }
  await section("Recursos").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await settle();
  await shot("08-sim-recursos-turnos", dock());
  // Solo ilustra el editor: ninguna tarea del ejemplo lo usa.
  await shiftBlock.locator(".sim-res-row > .sim-icon-btn").click();

  await selectElement("Task_Evaluar", "Evaluar riesgo crediticio manualmente", "Tareas");
  await settle();
  await shot("09-sim-tarea");
  await selectElement("Gw_Documentos", "¿Documentación completa?", "Compuertas");
  await settle();
  await shot("10-sim-compuerta");
  await selectElement("Event_Documentos", "Documentos recibidos del cliente", "Eventos / esperas");
  await settle();
  await shot("11-sim-evento");

  step("Simulación del AS-IS: resultados");
  await runSimulation();
  await settle(6000);
  await shot("12-sim-animacion");
  await panel().locator(".sim-play").click(); // pausa la animación
  await shotDock("13-sim-resultados");

  step("IA: diagnóstico del AS-IS");
  await openTab("IA");
  await askIa("Diagnosticar AS-IS");
  await shotDock("14-ia-diagnostico-asis");
  const computed = panel().locator("details.sim-ia-computed");
  if (await computed.count()) {
    await computed.evaluate((el) => { el.open = true; });
    await settle(300);
    await shotTall("15-ia-cifras-calculadas", computed);
  } else {
    console.log("    (sin modelo de lenguaje: el diagnóstico ya es el análisis calculado; no hay captura 15)");
  }

  step("BPMN TO-BE");
  await exitFullscreen();
  await page.locator(".bpmn-toggle-btn", { hasText: "TO-BE" }).click();
  await waitShape("Task_Scoring");
  await page.locator(".bpmn-procbar").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await settle(400);
  await fitDiagram();
  await shot("16-bpmn-tobe");

  step("Simulación del TO-BE");
  await enterFullscreen();
  await openSimulator();
  await openTab("IA");
  await panel().locator(".sim-ia-btn", { hasText: "Propuesta que salió del AS-IS" }).click();
  await panel().locator(".sim-ia-answer, .sim-ia .sim-warn").first().waitFor();
  await shotDock("17-ia-propuesta-en-tobe");
  await openTab("Configuración");
  await configure(TOBE);
  await runSimulation();
  await settle(1500);
  await panel().locator(".sim-play").click();
  await shotDock("18-sim-tobe-resultados");

  step("IA: veredicto AS-IS vs TO-BE");
  await openTab("IA");
  await askIa("Veredicto final");
  await shotDock("19-ia-veredicto");
  await exitFullscreen();

  step("AI Workspace");
  await goModule("Inicio");
  await page.locator(".org-module").waitFor();
  await page.locator(".shell-topbar-ai").click();
  await askWorkspace();
  await settle(1000);
  await shot("20-ai-workspace");
  await page.locator(".shell-topbar-ai").click();

  step("Conocimiento");
  await goModule("Conocimiento");
  await page.locator(".conocimiento-content canvas").first().waitFor({ timeout: 30_000 });
  await settle(3000);
  await page.locator(".obsidian-btn", { hasText: "Ajustar" }).click().catch(() => {});
  await settle(1500);
  await shot("21-conocimiento");

  step("Búsqueda (Ctrl+K)");
  await page.keyboard.press("Control+k");
  await page.locator(".command-palette").waitFor();
  await settle(400);
  await shot("22-busqueda-ctrl-k");
  await page.keyboard.press("Escape");
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await seed();

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ viewport: VIEWPORT, locale: "es-ES", deviceScaleFactor: 1 });
  page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("dialog", (d) => void d.accept());
  try {
    await tour();
    console.log(`\nCapturas listas en ${path.relative(ROOT, OUT)}`);
  } catch (err) {
    await mkdir(DEBUG, { recursive: true });
    await page.screenshot({ path: path.join(DEBUG, "fallo.png") }).catch(() => {});
    console.error(`\nFalló en ${page.url()}. Captura del momento: scripts/capturas/debug/fallo.png`);
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
