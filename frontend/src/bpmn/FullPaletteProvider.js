/**
 * FullPaletteProvider — paleta BPMN 2.0 COMPLETA para bpmn-js.
 *
 * Expone TODOS los elementos del estándar BPMN 2.0 directamente en la barra,
 * agrupados por categoría — 60+ entradas, paridad con ReplaceOptions de bpmn-js.
 *
 * Se registra como reemplazo del PaletteProvider nativo vía un módulo didi.
 */
import { assign } from "min-dash";

export default function FullPaletteProvider(
  palette, create, elementFactory,
  spaceTool, lassoTool, handTool,
  globalConnect, translate,
) {
  this._create = create;
  this._elementFactory = elementFactory;
  this._spaceTool = spaceTool;
  this._lassoTool = lassoTool;
  this._handTool = handTool;
  this._globalConnect = globalConnect;
  this._translate = translate;

  palette.registerProvider(this);
}

FullPaletteProvider.$inject = [
  "palette", "create", "elementFactory",
  "spaceTool", "lassoTool", "handTool",
  "globalConnect", "translate",
];

FullPaletteProvider.prototype.getPaletteEntries = function () {
  const create = this._create;
  const elementFactory = this._elementFactory;
  const spaceTool = this._spaceTool;
  const lassoTool = this._lassoTool;
  const handTool = this._handTool;
  const globalConnect = this._globalConnect;
  const translate = this._translate;

  const actions = {};

  function createAction(type, group, className, title, options) {
    function start(event) {
      const shape = elementFactory.createShape(assign({ type }, options || {}));
      create.start(event, shape);
    }
    return {
      group,
      className,
      title: translate(title),
      action: { dragstart: start, click: start },
    };
  }

  function createSubprocess(event) {
    const subProcess = elementFactory.createShape({
      type: "bpmn:SubProcess",
      x: 0, y: 0, isExpanded: true,
    });
    const startEvent = elementFactory.createShape({
      type: "bpmn:StartEvent", x: 40, y: 82, parent: subProcess,
    });
    create.start(event, [subProcess, startEvent], { hints: { autoSelect: [subProcess] } });
  }

  function createAdHoc(event) {
    const sub = elementFactory.createShape({
      type: "bpmn:AdHocSubProcess", x: 0, y: 0, isExpanded: true,
    });
    create.start(event, [sub], { hints: { autoSelect: [sub] } });
  }

  function createEventSubProcess(event) {
    const subProcess = elementFactory.createShape({
      type: "bpmn:SubProcess",
      x: 0, y: 0, isExpanded: true, triggeredByEvent: true,
    });
    const startEvent = elementFactory.createShape({
      type: "bpmn:StartEvent", x: 40, y: 82, parent: subProcess,
      eventDefinitionType: "bpmn:MessageEventDefinition",
    });
    create.start(event, [subProcess, startEvent], { hints: { autoSelect: [subProcess] } });
  }

  function createParticipant(event) {
    create.start(event, elementFactory.createParticipantShape());
  }

  assign(actions, {
    // ── Herramientas (5) ─────────────────────────────────────────────
    "hand-tool": {
      group: "tools",
      className: "bpmn-icon-hand-tool",
      title: translate("Mover lienzo (mano)"),
      action: { click: (e) => handTool.activateHand(e) },
    },
    "lasso-tool": {
      group: "tools",
      className: "bpmn-icon-lasso-tool",
      title: translate("Selección por lazo"),
      action: { click: (e) => lassoTool.activateSelection(e) },
    },
    "space-tool": {
      group: "tools",
      className: "bpmn-icon-space-tool",
      title: translate("Crear/quitar espacio"),
      action: { click: (e) => spaceTool.activateSelection(e) },
    },
    "global-connect-tool": {
      group: "tools",
      className: "bpmn-icon-connection-multi",
      title: translate("Herramienta de conexión global"),
      action: { click: (e) => globalConnect.start(e) },
    },
    "tool-separator": { group: "tools", separator: true },

    // ── Eventos de inicio (Alto nivel) (5) ───────────────────────────
    "create.start-event": createAction(
      "bpmn:StartEvent", "event-start", "bpmn-icon-start-event-none",
      "Inicio: simple",
    ),
    "create.start-message": createAction(
      "bpmn:StartEvent", "event-start", "bpmn-icon-start-event-message",
      "Inicio: mensaje", { eventDefinitionType: "bpmn:MessageEventDefinition" },
    ),
    "create.start-timer": createAction(
      "bpmn:StartEvent", "event-start", "bpmn-icon-start-event-timer",
      "Inicio: temporizador", { eventDefinitionType: "bpmn:TimerEventDefinition" },
    ),
    "create.start-conditional": createAction(
      "bpmn:StartEvent", "event-start", "bpmn-icon-start-event-condition",
      "Inicio: condicional", { eventDefinitionType: "bpmn:ConditionalEventDefinition" },
    ),
    "create.start-signal": createAction(
      "bpmn:StartEvent", "event-start", "bpmn-icon-start-event-signal",
      "Inicio: señal", { eventDefinitionType: "bpmn:SignalEventDefinition" },
    ),

    // ── Inicio de subproceso de evento — INTERRUPTOR (9) ─────────────
    "create.start-msg-interrupting": createAction(
      "bpmn:StartEvent", "event-start-sub", "bpmn-icon-start-event-message",
      "Inicio subproc · mensaje (interrumpe)",
      { eventDefinitionType: "bpmn:MessageEventDefinition", isInterrupting: true },
    ),
    "create.start-timer-interrupting": createAction(
      "bpmn:StartEvent", "event-start-sub", "bpmn-icon-start-event-timer",
      "Inicio subproc · timer (interrumpe)",
      { eventDefinitionType: "bpmn:TimerEventDefinition", isInterrupting: true },
    ),
    "create.start-esc-interrupting": createAction(
      "bpmn:StartEvent", "event-start-sub", "bpmn-icon-start-event-escalation",
      "Inicio subproc · escalación (interrumpe)",
      { eventDefinitionType: "bpmn:EscalationEventDefinition", isInterrupting: true },
    ),
    "create.start-cond-interrupting": createAction(
      "bpmn:StartEvent", "event-start-sub", "bpmn-icon-start-event-condition",
      "Inicio subproc · condicional (interrumpe)",
      { eventDefinitionType: "bpmn:ConditionalEventDefinition", isInterrupting: true },
    ),
    "create.start-error-interrupting": createAction(
      "bpmn:StartEvent", "event-start-sub", "bpmn-icon-start-event-error",
      "Inicio subproc · error (interrumpe)",
      { eventDefinitionType: "bpmn:ErrorEventDefinition", isInterrupting: true },
    ),
    "create.start-compensation-interrupting": createAction(
      "bpmn:StartEvent", "event-start-sub", "bpmn-icon-start-event-compensation",
      "Inicio subproc · compensación (interrumpe)",
      { eventDefinitionType: "bpmn:CompensateEventDefinition", isInterrupting: true },
    ),
    "create.start-signal-interrupting": createAction(
      "bpmn:StartEvent", "event-start-sub", "bpmn-icon-start-event-signal",
      "Inicio subproc · señal (interrumpe)",
      { eventDefinitionType: "bpmn:SignalEventDefinition", isInterrupting: true },
    ),
    "create.start-multiple-interrupting": createAction(
      "bpmn:StartEvent", "event-start-sub", "bpmn-icon-start-event-multiple",
      "Inicio subproc · múltiple (interrumpe)", { isInterrupting: true },
    ),
    "create.start-parmultiple-interrupting": createAction(
      "bpmn:StartEvent", "event-start-sub", "bpmn-icon-start-event-parallel-multiple",
      "Inicio subproc · paralelo múltiple (interrumpe)", { isInterrupting: true },
    ),

    // ── Inicio de subproceso de evento — NO INTERRUPTOR (7) ──────────
    "create.start-msg-noninterrupting": createAction(
      "bpmn:StartEvent", "event-start-sub-ni", "bpmn-icon-start-event-non-interrupting-message",
      "Inicio subproc · mensaje (no interrumpe)",
      { eventDefinitionType: "bpmn:MessageEventDefinition", isInterrupting: false },
    ),
    "create.start-timer-noninterrupting": createAction(
      "bpmn:StartEvent", "event-start-sub-ni", "bpmn-icon-start-event-non-interrupting-timer",
      "Inicio subproc · timer (no interrumpe)",
      { eventDefinitionType: "bpmn:TimerEventDefinition", isInterrupting: false },
    ),
    "create.start-esc-noninterrupting": createAction(
      "bpmn:StartEvent", "event-start-sub-ni", "bpmn-icon-start-event-non-interrupting-escalation",
      "Inicio subproc · escalación (no interrumpe)",
      { eventDefinitionType: "bpmn:EscalationEventDefinition", isInterrupting: false },
    ),
    "create.start-cond-noninterrupting": createAction(
      "bpmn:StartEvent", "event-start-sub-ni", "bpmn-icon-start-event-non-interrupting-condition",
      "Inicio subproc · condicional (no interrumpe)",
      { eventDefinitionType: "bpmn:ConditionalEventDefinition", isInterrupting: false },
    ),
    "create.start-signal-noninterrupting": createAction(
      "bpmn:StartEvent", "event-start-sub-ni", "bpmn-icon-start-event-non-interrupting-signal",
      "Inicio subproc · señal (no interrumpe)",
      { eventDefinitionType: "bpmn:SignalEventDefinition", isInterrupting: false },
    ),
    "create.start-multiple-noninterrupting": createAction(
      "bpmn:StartEvent", "event-start-sub-ni", "bpmn-icon-start-event-non-interrupting-multiple",
      "Inicio subproc · múltiple (no interrumpe)", { isInterrupting: false },
    ),
    "create.start-parmultiple-noninterrupting": createAction(
      "bpmn:StartEvent", "event-start-sub-ni", "bpmn-icon-start-event-non-interrupting-parallel-multiple",
      "Inicio subproc · paralelo múltiple (no interrumpe)", { isInterrupting: false },
    ),

    // ── Eventos intermedios (13) ─────────────────────────────────────
    "create.intermediate-throw": createAction(
      "bpmn:IntermediateThrowEvent", "event-intermediate", "bpmn-icon-intermediate-event-none",
      "Intermedio: sin tipo",
    ),
    "create.intermediate-message-catch": createAction(
      "bpmn:IntermediateCatchEvent", "event-intermediate", "bpmn-icon-intermediate-event-catch-message",
      "Intermedio: capturar mensaje", { eventDefinitionType: "bpmn:MessageEventDefinition" },
    ),
    "create.intermediate-message-throw": createAction(
      "bpmn:IntermediateThrowEvent", "event-intermediate", "bpmn-icon-intermediate-event-throw-message",
      "Intermedio: lanzar mensaje", { eventDefinitionType: "bpmn:MessageEventDefinition" },
    ),
    "create.intermediate-timer": createAction(
      "bpmn:IntermediateCatchEvent", "event-intermediate", "bpmn-icon-intermediate-event-catch-timer",
      "Intermedio: temporizador", { eventDefinitionType: "bpmn:TimerEventDefinition" },
    ),
    "create.intermediate-conditional": createAction(
      "bpmn:IntermediateCatchEvent", "event-intermediate", "bpmn-icon-intermediate-event-catch-condition",
      "Intermedio: condicional", { eventDefinitionType: "bpmn:ConditionalEventDefinition" },
    ),
    "create.intermediate-signal-catch": createAction(
      "bpmn:IntermediateCatchEvent", "event-intermediate", "bpmn-icon-intermediate-event-catch-signal",
      "Intermedio: capturar señal", { eventDefinitionType: "bpmn:SignalEventDefinition" },
    ),
    "create.intermediate-signal-throw": createAction(
      "bpmn:IntermediateThrowEvent", "event-intermediate", "bpmn-icon-intermediate-event-throw-signal",
      "Intermedio: lanzar señal", { eventDefinitionType: "bpmn:SignalEventDefinition" },
    ),
    "create.intermediate-link-catch": createAction(
      "bpmn:IntermediateCatchEvent", "event-intermediate", "bpmn-icon-intermediate-event-catch-link",
      "Intermedio: capturar enlace", { eventDefinitionType: "bpmn:LinkEventDefinition" },
    ),
    "create.intermediate-link-throw": createAction(
      "bpmn:IntermediateThrowEvent", "event-intermediate", "bpmn-icon-intermediate-event-throw-link",
      "Intermedio: lanzar enlace", { eventDefinitionType: "bpmn:LinkEventDefinition" },
    ),
    "create.intermediate-escalation-throw": createAction(
      "bpmn:IntermediateThrowEvent", "event-intermediate", "bpmn-icon-intermediate-event-throw-escalation",
      "Intermedio: lanzar escalación", { eventDefinitionType: "bpmn:EscalationEventDefinition" },
    ),
    "create.intermediate-compensation-catch": createAction(
      "bpmn:IntermediateCatchEvent", "event-intermediate", "bpmn-icon-intermediate-event-catch-compensation",
      "Intermedio: capturar compensación", { eventDefinitionType: "bpmn:CompensateEventDefinition" },
    ),
    "create.intermediate-compensation-throw": createAction(
      "bpmn:IntermediateThrowEvent", "event-intermediate", "bpmn-icon-intermediate-event-throw-compensation",
      "Intermedio: lanzar compensación", { eventDefinitionType: "bpmn:CompensateEventDefinition" },
    ),
    "create.intermediate-multiple-catch": createAction(
      "bpmn:IntermediateCatchEvent", "event-intermediate", "bpmn-icon-intermediate-event-catch-multiple",
      "Intermedio: capturar múltiple",
    ),
    "create.intermediate-parallel-multiple-catch": createAction(
      "bpmn:IntermediateCatchEvent", "event-intermediate", "bpmn-icon-intermediate-event-catch-parallel-multiple",
      "Intermedio: paralelo múltiple",
    ),
    "create.intermediate-multiple-throw": createAction(
      "bpmn:IntermediateThrowEvent", "event-intermediate", "bpmn-icon-intermediate-event-throw-multiple",
      "Intermedio: lanzar múltiple",
    ),

    // ── Eventos de fin (8) ───────────────────────────────────────────
    "create.end-event": createAction(
      "bpmn:EndEvent", "event-end", "bpmn-icon-end-event-none",
      "Fin: sin tipo",
    ),
    "create.end-message": createAction(
      "bpmn:EndEvent", "event-end", "bpmn-icon-end-event-message",
      "Fin: mensaje", { eventDefinitionType: "bpmn:MessageEventDefinition" },
    ),
    "create.end-signal": createAction(
      "bpmn:EndEvent", "event-end", "bpmn-icon-end-event-signal",
      "Fin: señal", { eventDefinitionType: "bpmn:SignalEventDefinition" },
    ),
    "create.end-error": createAction(
      "bpmn:EndEvent", "event-end", "bpmn-icon-end-event-error",
      "Fin: error", { eventDefinitionType: "bpmn:ErrorEventDefinition" },
    ),
    "create.end-escalation": createAction(
      "bpmn:EndEvent", "event-end", "bpmn-icon-end-event-escalation",
      "Fin: escalación", { eventDefinitionType: "bpmn:EscalationEventDefinition" },
    ),
    "create.end-cancel": createAction(
      "bpmn:EndEvent", "event-end", "bpmn-icon-end-event-cancel",
      "Fin: cancelación", { eventDefinitionType: "bpmn:CancelEventDefinition" },
    ),
    "create.end-compensation": createAction(
      "bpmn:EndEvent", "event-end", "bpmn-icon-end-event-compensation",
      "Fin: compensación", { eventDefinitionType: "bpmn:CompensateEventDefinition" },
    ),
    "create.end-multiple": createAction(
      "bpmn:EndEvent", "event-end", "bpmn-icon-end-event-multiple",
      "Fin: múltiple",
    ),
    "create.end-link": createAction(
      "bpmn:EndEvent", "event-end", "bpmn-icon-end-event-link",
      "Fin: enlace", { eventDefinitionType: "bpmn:LinkEventDefinition" },
    ),
    "create.end-terminate": createAction(
      "bpmn:EndEvent", "event-end", "bpmn-icon-end-event-terminate",
      "Fin: terminación", { eventDefinitionType: "bpmn:TerminateEventDefinition" },
    ),

    // ── Eventos de borde (boundary, anidados a actividades) (8) ──────
    // Nota: boundary events solo se pueden ANCLAR sobre tasks/subprocesos
    // existentes. Si no hay actividad seleccionada, bpmn-js los crea como
    // IntermediateCatchEvent flotante, igualmente útil.
    "create.boundary-message": createAction(
      "bpmn:BoundaryEvent", "event-boundary", "bpmn-icon-intermediate-event-catch-message",
      "Borde: mensaje (interrumpe)", { eventDefinitionType: "bpmn:MessageEventDefinition" },
    ),
    "create.boundary-timer": createAction(
      "bpmn:BoundaryEvent", "event-boundary", "bpmn-icon-intermediate-event-catch-timer",
      "Borde: temporizador (interrumpe)", { eventDefinitionType: "bpmn:TimerEventDefinition" },
    ),
    "create.boundary-signal": createAction(
      "bpmn:BoundaryEvent", "event-boundary", "bpmn-icon-intermediate-event-catch-signal",
      "Borde: señal (interrumpe)", { eventDefinitionType: "bpmn:SignalEventDefinition" },
    ),
    "create.boundary-error": createAction(
      "bpmn:BoundaryEvent", "event-boundary", "bpmn-icon-intermediate-event-catch-error",
      "Borde: error (interrumpe)", { eventDefinitionType: "bpmn:ErrorEventDefinition" },
    ),
    "create.boundary-escalation": createAction(
      "bpmn:BoundaryEvent", "event-boundary", "bpmn-icon-intermediate-event-catch-escalation",
      "Borde: escalación (interrumpe)", { eventDefinitionType: "bpmn:EscalationEventDefinition" },
    ),
    "create.boundary-cancel": createAction(
      "bpmn:BoundaryEvent", "event-boundary", "bpmn-icon-intermediate-event-catch-cancel",
      "Borde: cancelación", { eventDefinitionType: "bpmn:CancelEventDefinition" },
    ),
    "create.boundary-compensation": createAction(
      "bpmn:BoundaryEvent", "event-boundary", "bpmn-icon-intermediate-event-catch-compensation",
      "Borde: compensación", { eventDefinitionType: "bpmn:CompensateEventDefinition" },
    ),
    "create.boundary-conditional": createAction(
      "bpmn:BoundaryEvent", "event-boundary", "bpmn-icon-intermediate-event-catch-condition",
      "Borde: condicional (interrumpe)", { eventDefinitionType: "bpmn:ConditionalEventDefinition" },
    ),
    "create.boundary-multiple": createAction(
      "bpmn:BoundaryEvent", "event-boundary", "bpmn-icon-intermediate-event-catch-multiple",
      "Borde: múltiple (interrumpe)",
    ),
    "create.boundary-parallel-multiple": createAction(
      "bpmn:BoundaryEvent", "event-boundary", "bpmn-icon-intermediate-event-catch-parallel-multiple",
      "Borde: paralelo múltiple (interrumpe)",
    ),

    // ── Boundary NO INTERRUPTOR (7) ──────────────────────────────────
    "create.boundary-ni-message": createAction(
      "bpmn:BoundaryEvent", "event-boundary-ni", "bpmn-icon-intermediate-event-catch-non-interrupting-message",
      "Borde: mensaje (no interrumpe)",
      { eventDefinitionType: "bpmn:MessageEventDefinition", cancelActivity: false },
    ),
    "create.boundary-ni-timer": createAction(
      "bpmn:BoundaryEvent", "event-boundary-ni", "bpmn-icon-intermediate-event-catch-non-interrupting-timer",
      "Borde: timer (no interrumpe)",
      { eventDefinitionType: "bpmn:TimerEventDefinition", cancelActivity: false },
    ),
    "create.boundary-ni-escalation": createAction(
      "bpmn:BoundaryEvent", "event-boundary-ni", "bpmn-icon-intermediate-event-catch-non-interrupting-escalation",
      "Borde: escalación (no interrumpe)",
      { eventDefinitionType: "bpmn:EscalationEventDefinition", cancelActivity: false },
    ),
    "create.boundary-ni-conditional": createAction(
      "bpmn:BoundaryEvent", "event-boundary-ni", "bpmn-icon-intermediate-event-catch-non-interrupting-condition",
      "Borde: condicional (no interrumpe)",
      { eventDefinitionType: "bpmn:ConditionalEventDefinition", cancelActivity: false },
    ),
    "create.boundary-ni-signal": createAction(
      "bpmn:BoundaryEvent", "event-boundary-ni", "bpmn-icon-intermediate-event-catch-non-interrupting-signal",
      "Borde: señal (no interrumpe)",
      { eventDefinitionType: "bpmn:SignalEventDefinition", cancelActivity: false },
    ),
    "create.boundary-ni-multiple": createAction(
      "bpmn:BoundaryEvent", "event-boundary-ni", "bpmn-icon-intermediate-event-catch-non-interrupting-multiple",
      "Borde: múltiple (no interrumpe)", { cancelActivity: false },
    ),
    "create.boundary-ni-parmultiple": createAction(
      "bpmn:BoundaryEvent", "event-boundary-ni", "bpmn-icon-intermediate-event-catch-non-interrupting-parallel-multiple",
      "Borde: paralelo múltiple (no interrumpe)", { cancelActivity: false },
    ),

    // ── Gateways (5) ─────────────────────────────────────────────────
    "create.exclusive-gateway": createAction(
      "bpmn:ExclusiveGateway", "gateway", "bpmn-icon-gateway-xor",
      "Gateway exclusivo (XOR)",
    ),
    "create.parallel-gateway": createAction(
      "bpmn:ParallelGateway", "gateway", "bpmn-icon-gateway-parallel",
      "Gateway paralelo (AND)",
    ),
    "create.inclusive-gateway": createAction(
      "bpmn:InclusiveGateway", "gateway", "bpmn-icon-gateway-or",
      "Gateway inclusivo (OR)",
    ),
    "create.event-gateway": createAction(
      "bpmn:EventBasedGateway", "gateway", "bpmn-icon-gateway-eventbased",
      "Gateway basado en eventos",
    ),
    "create.complex-gateway": createAction(
      "bpmn:ComplexGateway", "gateway", "bpmn-icon-gateway-complex",
      "Gateway complejo",
    ),

    // ── Tareas / actividades (13) ────────────────────────────────────
    "create.task": createAction(
      "bpmn:Task", "activity", "bpmn-icon-task",
      "Tarea genérica",
    ),
    "create.user-task": createAction(
      "bpmn:UserTask", "activity", "bpmn-icon-user-task",
      "Tarea de usuario",
    ),
    "create.service-task": createAction(
      "bpmn:ServiceTask", "activity", "bpmn-icon-service-task",
      "Tarea de servicio",
    ),
    "create.send-task": createAction(
      "bpmn:SendTask", "activity", "bpmn-icon-send-task",
      "Tarea de envío",
    ),
    "create.receive-task": createAction(
      "bpmn:ReceiveTask", "activity", "bpmn-icon-receive-task",
      "Tarea de recepción",
    ),
    "create.manual-task": createAction(
      "bpmn:ManualTask", "activity", "bpmn-icon-manual-task",
      "Tarea manual",
    ),
    "create.script-task": createAction(
      "bpmn:ScriptTask", "activity", "bpmn-icon-script-task",
      "Tarea de script",
    ),
    "create.business-rule-task": createAction(
      "bpmn:BusinessRuleTask", "activity", "bpmn-icon-business-rule-task",
      "Tarea de regla de negocio",
    ),
    "create.call-activity": createAction(
      "bpmn:CallActivity", "activity", "bpmn-icon-call-activity",
      "Call activity (subproceso reutilizable)",
    ),
    "create.subprocess-collapsed": createAction(
      "bpmn:SubProcess", "activity", "bpmn-icon-subprocess-collapsed",
      "Subproceso colapsado", { isExpanded: false },
    ),
    "create.subprocess-expanded": {
      group: "activity",
      className: "bpmn-icon-subprocess-expanded",
      title: translate("Subproceso expandido"),
      action: { dragstart: createSubprocess, click: createSubprocess },
    },
    "create.event-subprocess": {
      group: "activity",
      className: "bpmn-icon-event-subprocess-expanded",
      title: translate("Subproceso de evento"),
      action: { dragstart: createEventSubProcess, click: createEventSubProcess },
    },
    "create.ad-hoc-subprocess": {
      group: "activity",
      className: "bpmn-icon-subprocess-expanded",
      title: translate("Subproceso ad-hoc (~)"),
      action: { dragstart: createAdHoc, click: createAdHoc },
    },
    "create.transaction": createAction(
      "bpmn:Transaction", "activity", "bpmn-icon-transaction",
      "Transacción", { isExpanded: true },
    ),

    // ── Datos (2) ────────────────────────────────────────────────────
    "create.data-object": createAction(
      "bpmn:DataObjectReference", "data", "bpmn-icon-data-object",
      "Objeto de datos",
    ),
    "create.data-store": createAction(
      "bpmn:DataStoreReference", "data", "bpmn-icon-data-store",
      "Almacén de datos",
    ),

    // ── Colaboración (1) + Artefactos (2) ────────────────────────────
    "create.participant-expanded": {
      group: "collaboration",
      className: "bpmn-icon-participant",
      title: translate("Pool / Participante"),
      action: { dragstart: createParticipant, click: createParticipant },
    },
    "create.group": createAction(
      "bpmn:Group", "artifact", "bpmn-icon-group",
      "Grupo",
    ),
    "create.text-annotation": createAction(
      "bpmn:TextAnnotation", "artifact", "bpmn-icon-text-annotation",
      "Anotación de texto",
    ),
  });

  return actions;
};
