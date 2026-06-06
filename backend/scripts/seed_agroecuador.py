"""
Seed script: AgroExport Ecuador S.A.
Empresa ejemplo — exportadora ecuatoriana de productos agrícolas.

Crea:
- 1 empresa con misión/visión/valores/objetivos
- 9 macroprocesos N1 (3 estratégicos + 4 operativos + 2 de soporte)
- 5 procesos N2 dentro de operaciones
- 4 subprocesos N3 dentro de "Producción y procesamiento"
- 3 stakeholders + 2 entrevistas + 6 elementos AS-IS para uno de los N2
- 1 BPMN guardado en un N2
- 2 aprobaciones (1 pendiente, 1 aprobada) + 3 comentarios
- 4 documentos en la biblioteca de conocimiento
"""
from __future__ import annotations
import json
import uuid
from datetime import datetime, UTC

from app.db.session import SessionLocal
from app.models.company import CompanyModel
from app.models.process_case import ProcessCaseModel
from app.models.process_repository import (
    ProcessArtifactModel, ArtifactVersionModel, ProcessRepositoryModel,
)
from app.models.discovery import (
    ProcessStakeholderModel, ProcessInterviewModel, ProcessAsIsElementModel,
)
from app.models.knowledge import KnowledgeDocumentModel


def now() -> datetime:
    return datetime.now(UTC)


# ── BPMN XML para Cosecha de Banano ─────────────────────────────────────────

BANANA_HARVEST_BPMN = """<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Cosecha" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Plantación lista (12 semanas)">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_1" name="Inspección de madurez del racimo">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:exclusiveGateway id="Gateway_1" name="¿Grado madurez?">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_3a</bpmn:outgoing>
      <bpmn:outgoing>Flow_3b</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="Task_2" name="Corte del racimo">
      <bpmn:incoming>Flow_3a</bpmn:incoming>
      <bpmn:outgoing>Flow_4</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_3" name="Marcar para próxima cosecha">
      <bpmn:incoming>Flow_3b</bpmn:incoming>
      <bpmn:outgoing>Flow_5</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_4" name="Transporte a empacadora (cable vía)">
      <bpmn:incoming>Flow_4</bpmn:incoming>
      <bpmn:outgoing>Flow_6</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_5" name="Pesaje y registro">
      <bpmn:incoming>Flow_6</bpmn:incoming>
      <bpmn:outgoing>Flow_7</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="EndEvent_1" name="Racimo en empacadora">
      <bpmn:incoming>Flow_7</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="EndEvent_2" name="Continúa en planta">
      <bpmn:incoming>Flow_5</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="Gateway_1" />
    <bpmn:sequenceFlow id="Flow_3a" name="Listo" sourceRef="Gateway_1" targetRef="Task_2" />
    <bpmn:sequenceFlow id="Flow_3b" name="No listo" sourceRef="Gateway_1" targetRef="Task_3" />
    <bpmn:sequenceFlow id="Flow_4" sourceRef="Task_2" targetRef="Task_4" />
    <bpmn:sequenceFlow id="Flow_5" sourceRef="Task_3" targetRef="EndEvent_2" />
    <bpmn:sequenceFlow id="Flow_6" sourceRef="Task_4" targetRef="Task_5" />
    <bpmn:sequenceFlow id="Flow_7" sourceRef="Task_5" targetRef="EndEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_Cosecha">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="152" y="142" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="130" y="185" width="80" height="27" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="240" y="120" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_1_di" bpmnElement="Gateway_1" isMarkerVisible="true">
        <dc:Bounds x="395" y="135" width="50" height="50" />
        <bpmndi:BPMNLabel><dc:Bounds x="395" y="105" width="50" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="500" y="60" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_3_di" bpmnElement="Task_3">
        <dc:Bounds x="500" y="200" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_4_di" bpmnElement="Task_4">
        <dc:Bounds x="660" y="60" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_5_di" bpmnElement="Task_5">
        <dc:Bounds x="820" y="60" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1">
        <dc:Bounds x="980" y="82" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="955" y="125" width="86" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_2_di" bpmnElement="EndEvent_2">
        <dc:Bounds x="660" y="222" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="640" y="265" width="76" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint x="188" y="160" /><di:waypoint x="240" y="160" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2"><di:waypoint x="340" y="160" /><di:waypoint x="395" y="160" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_3a_di" bpmnElement="Flow_3a"><di:waypoint x="420" y="135" /><di:waypoint x="420" y="100" /><di:waypoint x="500" y="100" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_3b_di" bpmnElement="Flow_3b"><di:waypoint x="420" y="185" /><di:waypoint x="420" y="240" /><di:waypoint x="500" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_4_di" bpmnElement="Flow_4"><di:waypoint x="600" y="100" /><di:waypoint x="660" y="100" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_5_di" bpmnElement="Flow_5"><di:waypoint x="600" y="240" /><di:waypoint x="660" y="240" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_6_di" bpmnElement="Flow_6"><di:waypoint x="760" y="100" /><di:waypoint x="820" y="100" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_7_di" bpmnElement="Flow_7"><di:waypoint x="920" y="100" /><di:waypoint x="980" y="100" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>"""


def seed():
    db = SessionLocal()

    try:
        # ─── 1. EMPRESA ────────────────────────────────────────────────────
        company = CompanyModel(
            id=str(uuid.uuid4()),
            razon_social="AgroExport Ecuador S.A.",
            nombre_corto="AgroExport",
            sector="Agricultura — Exportación de productos agrícolas frescos y procesados",
            tamano="mediana",
            mision=(
                "Producir y exportar productos agrícolas ecuatorianos de la más alta calidad "
                "(banano, cacao, café, flores) cumpliendo los más rigurosos estándares "
                "internacionales de inocuidad, sostenibilidad y comercio justo, generando "
                "valor para nuestros productores, colaboradores, clientes y comunidades locales."
            ),
            vision=(
                "Para 2030, ser la empresa exportadora agrícola líder del Ecuador en presencia "
                "internacional, reconocida por la trazabilidad completa de su cadena de valor, "
                "la sostenibilidad de sus operaciones y la innovación en productos de alto valor "
                "agregado para los mercados europeo, norteamericano y asiático."
            ),
            valores=(
                "1. Calidad sin compromisos en cada eslabón de la cadena.\n"
                "2. Sostenibilidad ambiental y social como eje estratégico.\n"
                "3. Trazabilidad total: del campo a la mesa.\n"
                "4. Trato justo y desarrollo de productores y colaboradores.\n"
                "5. Innovación continua en procesos y productos.\n"
                "6. Cumplimiento estricto de normativas nacionales e internacionales."
            ),
            objetivos_estrategicos=json.dumps([
                "Aumentar exportaciones FOB en 25% para 2027 (vs. 2025)",
                "Obtener certificación GlobalG.A.P. en el 100% de fincas propias",
                "Reducir huella de carbono operacional en 30% para 2028",
                "Diversificar mercados: alcanzar 15% de ventas en Asia para 2027",
                "Lanzar línea de productos procesados (puré, snack, chocolate fino) en 2026",
                "Digitalizar el 100% del proceso de trazabilidad agro→puerto para 2026",
            ]),
            planificacion_estrategica=(
                "Estrategia 2025-2030: Crecimiento sostenible mediante diversificación geográfica "
                "(Europa→Asia), integración vertical hacia productos procesados de alto margen, "
                "digitalización end-to-end de la trazabilidad, y certificación integral en "
                "sostenibilidad (Rainforest Alliance, Fairtrade, Carbon Neutral)."
            ),
            cadena_valor=json.dumps({
                "actividades_primarias": [
                    "Logística interna: recepción de materia prima de fincas propias y asociadas",
                    "Operaciones: clasificación, lavado, empaque y procesamiento",
                    "Logística externa: paletizado, refrigeración y despacho al puerto",
                    "Marketing y ventas: gestión de cuentas con importadores internacionales",
                    "Servicio post-venta: trazabilidad, certificaciones y atención de reclamos",
                ],
                "actividades_apoyo": [
                    "Infraestructura: gobierno corporativo, finanzas, legal",
                    "Recursos humanos: contratación, capacitación, bienestar",
                    "Desarrollo tecnológico: sistemas de trazabilidad e información",
                    "Compras: insumos agrícolas, empaque, servicios logísticos",
                ],
            }),
            created_at=now(),
            updated_at=now(),
        )
        db.add(company)
        db.flush()
        print(f"✅ Empresa: {company.razon_social} (id={company.id})")

        # ─── 2. CASOS BPM JERÁRQUICOS ──────────────────────────────────────
        cases: dict[str, ProcessCaseModel] = {}

        def add_case(
            key: str, name: str, level: int, process_type: str,
            objective: str, scope: str, owner: str, area: str,
            parent_key: str | None = None,
            map_status: str = "identificado",
        ) -> ProcessCaseModel:
            parent_id = cases[parent_key].id if parent_key else None
            c = ProcessCaseModel(
                id=str(uuid.uuid4()),
                name=name,
                area=area,
                objective=objective,
                scope=scope,
                owner=owner,
                status="draft",
                process_type=process_type,
                level=level,
                parent_id=parent_id,
                map_status=map_status,
                analysis_status="pendiente",
                staleness="ok",
                transversal=False,
                created_at=now(),
                updated_at=now(),
            )
            db.add(c)
            db.flush()
            cases[key] = c
            return c

        # ─── N1: 9 Macroprocesos según cadena Porter ───────────────────────
        # IMPORTANTE: area debe ser exactamente "Estratégico"/"Operativo"/"Soporte"
        # para que la vista MacroProcesosView los clasifique correctamente.
        # Estratégicos
        add_case("estrategia", "Gestión Estratégica", 1, "proceso",
                 "Definir y desplegar la estrategia corporativa 2025-2030",
                 "Visión, misión, planificación estratégica, KPIs corporativos",
                 "Gerente General", "Estratégico")
        add_case("calidad_corp", "Gestión de Calidad y Certificaciones", 1, "proceso",
                 "Mantener certificaciones internacionales (GlobalG.A.P., Rainforest, Fairtrade)",
                 "Auditorías, certificaciones, mejora continua, sistema de gestión de calidad",
                 "Gerente de Calidad", "Estratégico")
        add_case("sostenibilidad", "Gestión de Sostenibilidad", 1, "proceso",
                 "Reducir huella ambiental y cumplir compromisos ESG",
                 "Huella de carbono, agua, biodiversidad, relación con comunidades",
                 "Gerente de Sostenibilidad", "Estratégico")

        # Operativos (cadena de valor Porter)
        add_case("logistica_in", "Logística de Entrada (Recepción)", 1, "proceso",
                 "Asegurar el flujo continuo de materia prima desde fincas a planta",
                 "Recepción, inspección y almacenamiento de banano, cacao y café",
                 "Jefe de Recepción", "Operativo")
        add_case("produccion", "Producción y Procesamiento", 1, "proceso",
                 "Procesar la materia prima cumpliendo estándares de inocuidad y calidad",
                 "Cosecha, clasificación, lavado, empaque, procesamiento",
                 "Gerente de Operaciones", "Operativo")
        add_case("logistica_out", "Logística de Salida (Exportación)", 1, "proceso",
                 "Garantizar el despacho oportuno y la cadena de frío hasta el puerto",
                 "Paletización, refrigeración, transporte terrestre, gestión aduanera",
                 "Jefe de Logística Internacional", "Operativo")
        add_case("ventas", "Marketing, Ventas y Comercialización Internacional", 1, "proceso",
                 "Generar y mantener cartera de clientes internacionales",
                 "Gestión de cuentas, contratos, pricing, ferias internacionales",
                 "Gerente Comercial", "Operativo")

        # Soporte
        add_case("rrhh", "Gestión de Talento Humano", 1, "proceso",
                 "Atraer, desarrollar y retener talento para sostener la operación",
                 "Reclutamiento, nómina, capacitación, bienestar laboral",
                 "Gerente de RRHH", "Soporte")
        add_case("ti", "Tecnologías de Información y Trazabilidad", 1, "proceso",
                 "Mantener sistemas que soportan la trazabilidad y operación",
                 "ERP, sistemas de trazabilidad GPS, soporte usuarios",
                 "Gerente de TI", "Soporte")

        # ─── N2: Procesos dentro de Producción y Procesamiento ─────────────
        add_case("p_cosecha", "Cosecha y Recolección en Campo", 2, "proceso",
                 "Cosechar racimos/granos cumpliendo grados de madurez y calidad",
                 "Banano: corte de racimos verdes grado 39-42. Cacao: corte mazorcas maduras.",
                 "Jefe de Cosecha", "Producción", parent_key="produccion",
                 map_status="documentado")
        add_case("p_clasificacion", "Clasificación y Selección", 2, "proceso",
                 "Clasificar producto por calidad (Premium / Primera / Segunda / Rechazo)",
                 "Inspección visual, calibre, peso, defectos. Aplica a banano y cacao.",
                 "Supervisor de Calidad de Producción", "Producción", parent_key="produccion")
        add_case("p_lavado", "Lavado y Tratamiento Post-cosecha", 2, "proceso",
                 "Limpiar producto y aplicar tratamientos antifúngicos autorizados",
                 "Tinas de desleche, fungicida, escurrido. Solo banano.",
                 "Jefe de Empacadora", "Producción", parent_key="produccion")
        add_case("p_empaque", "Empaque y Etiquetado", 2, "proceso",
                 "Empacar producto en cajas con marca del cliente",
                 "Cajas de 18.14 kg, etiqueta con código de trazabilidad",
                 "Supervisor de Empaque", "Producción", parent_key="produccion")
        add_case("p_procesamiento", "Procesamiento de Productos Derivados", 2, "proceso",
                 "Producir derivados de cacao (licor, manteca, polvo) y banano (puré, snack)",
                 "Aplica a la planta de procesamiento. Productos de mayor valor agregado.",
                 "Jefe de Planta de Procesados", "Producción", parent_key="produccion")

        # ─── N3: Subprocesos de Cosecha ────────────────────────────────────
        add_case("sp_inspeccion", "Inspección de madurez previa al corte", 3, "subproceso",
                 "Verificar grado de madurez óptimo antes del corte",
                 "Aplicación de cinta de colores por semana de cosecha",
                 "Cosechero líder", "Producción", parent_key="p_cosecha",
                 map_status="documentado")
        add_case("sp_corte", "Corte y manejo del racimo", 3, "subproceso",
                 "Cortar el racimo sin daño y transportarlo a cable vía",
                 "Uso de machete, soporte del racimo, traslado a percha",
                 "Cosechero", "Producción", parent_key="p_cosecha")
        add_case("sp_transporte", "Transporte interno por cable vía", 3, "subproceso",
                 "Mover racimos desde el campo a la empacadora sin daño mecánico",
                 "Sistema de cable vía con ganchos. Máx 25 racimos por viaje.",
                 "Auxiliar de cable vía", "Producción", parent_key="p_cosecha")
        add_case("sp_recepcion_emp", "Recepción en empacadora", 3, "subproceso",
                 "Recibir racimos en empacadora con registro de peso y trazabilidad",
                 "Pesaje en báscula, escaneo de etiqueta del lote, registro en ERP",
                 "Auxiliar de empacadora", "Producción", parent_key="p_cosecha")

        db.commit()
        print(f"✅ {len(cases)} casos BPM creados (jerarquía N1→N2→N3)")

        # ─── 3. STAKEHOLDERS para "Cosecha y Recolección" ──────────────────
        cosecha = cases["p_cosecha"]
        stakeholders = [
            ProcessStakeholderModel(
                id=str(uuid.uuid4()), case_id=cosecha.id,
                name="Carlos Mendoza", role="Jefe de Cosecha",
                area="Producción - Campo", email="cmendoza@agroexport.ec",
                influence_level="alta",
                notes="Lleva 15 años en la empresa. Conoce todos los lotes y los ritmos de "
                      "maduración. Es la voz autorizada sobre cuándo cortar.",
                created_at=now(), updated_at=now(),
            ),
            ProcessStakeholderModel(
                id=str(uuid.uuid4()), case_id=cosecha.id,
                name="María Quishpe", role="Cosechera senior",
                area="Producción - Campo",
                influence_level="media",
                notes="Líder informal de las cuadrillas de cosecha. Conoce los problemas "
                      "operativos del día a día.",
                created_at=now(), updated_at=now(),
            ),
            ProcessStakeholderModel(
                id=str(uuid.uuid4()), case_id=cosecha.id,
                name="Ing. Diego Vásquez", role="Supervisor de Calidad",
                area="Calidad", email="dvasquez@agroexport.ec",
                influence_level="alta",
                notes="Define los criterios de aceptación. Reporta los rechazos.",
                created_at=now(), updated_at=now(),
            ),
        ]
        for s in stakeholders:
            db.add(s)
        db.flush()
        print(f"✅ {len(stakeholders)} stakeholders en 'Cosecha y Recolección'")

        # ─── 4. ENTREVISTAS y ELEMENTOS AS-IS ──────────────────────────────
        interview1 = ProcessInterviewModel(
            id=str(uuid.uuid4()), case_id=cosecha.id,
            stakeholder_id=stakeholders[0].id,
            title="Entrevista con Carlos Mendoza — Flujo general de cosecha",
            interview_type="individual", status="realizada",
            scheduled_at=now(),
            objective="Mapear el flujo completo desde la inspección de madurez hasta la "
                      "recepción en empacadora. Identificar puntos de control y reglas.",
            notes=(
                "Resumen — Entrevista del 22-mayo-2026:\n\n"
                "El proceso comienza los lunes y miércoles. Los cosecheros recorren los lotes "
                "según el calendario de cintas de colores (cada color = semana de floración). "
                "Verifican el grado de madurez: para exportación se corta entre grado 39 y 42 "
                "según el cliente. Una vez listo, se corta con machete cuidando no golpear el "
                "racimo. Se acomoda en el cable vía con un gancho protector. Máximo 25 "
                "racimos por viaje, sino se rompen las pencas.\n\n"
                "Carlos enfatiza que el cuello de botella principal es el transporte: cuando "
                "se acumula producto en cable vía, hay esperas largas. También menciona que "
                "el control de calidad en empacadora a veces rechaza lotes completos por "
                "manchas que ya venían del campo — sería mejor detectarlas antes."
            ),
            summary="Flujo cosecha → cable vía → empacadora. Cuello de botella en transporte. "
                    "Rechazos por manchas detectadas tardíamente.",
            created_at=now(), updated_at=now(),
        )
        interview2 = ProcessInterviewModel(
            id=str(uuid.uuid4()), case_id=cosecha.id,
            stakeholder_id=stakeholders[2].id,
            title="Entrevista con Ing. Vásquez — Criterios de calidad y rechazos",
            interview_type="individual", status="realizada",
            objective="Documentar los criterios formales de aceptación y los motivos más "
                      "frecuentes de rechazo.",
            notes=(
                "Criterios de aceptación para banano de exportación:\n"
                "- Grado de madurez: 39 a 42 (visualmente verde sin estriado amarillo)\n"
                "- Longitud de los dedos: 8 pulgadas mínimo\n"
                "- Calibre: 39 a 46 mm\n"
                "- Sin manchas negras, sin daño de pájaro, sin tip rot\n"
                "- Pencas completas, no menos de 4 dedos por penca\n\n"
                "Motivos de rechazo más frecuentes (Q1-2026): manchas por sigatoka (38%), "
                "daño mecánico de cable vía (24%), inmadurez (18%), calibre fuera de rango (12%), "
                "otros (8%).\n\n"
                "Recomendación: implementar inspección visual previa en campo para no "
                "transportar racimos que serán rechazados, lo cual ahorraría costos de cable vía."
            ),
            summary="Criterios formales + motivos de rechazo Q1-2026. Sigatoka 38%, "
                    "daño mecánico 24%, inmadurez 18%.",
            created_at=now(), updated_at=now(),
        )
        db.add(interview1)
        db.add(interview2)
        db.flush()

        as_is = [
            ProcessAsIsElementModel(
                id=str(uuid.uuid4()), case_id=cosecha.id, interview_id=interview1.id,
                element_type="activity", name="Inspección de madurez del racimo",
                description="Cosechero verifica el color de la cinta y el grado visual del racimo",
                source_excerpt="Verifican el grado de madurez: para exportación se corta entre grado 39 y 42 según el cliente",
                confidence_level="alta", created_by="auto-extract",
                created_at=now(), updated_at=now(),
            ),
            ProcessAsIsElementModel(
                id=str(uuid.uuid4()), case_id=cosecha.id, interview_id=interview1.id,
                element_type="gateway", name="Decisión: ¿Grado de madurez óptimo?",
                description="Si está en grado 39-42 se corta. Si está verde se marca para próxima cosecha.",
                confidence_level="alta", created_by="auto-extract",
                created_at=now(), updated_at=now(),
            ),
            ProcessAsIsElementModel(
                id=str(uuid.uuid4()), case_id=cosecha.id, interview_id=interview1.id,
                element_type="activity", name="Corte del racimo con machete",
                description="Cosechero corta el racimo cuidando no golpear las pencas",
                confidence_level="alta", created_by="auto-extract",
                created_at=now(), updated_at=now(),
            ),
            ProcessAsIsElementModel(
                id=str(uuid.uuid4()), case_id=cosecha.id, interview_id=interview1.id,
                element_type="activity", name="Transporte por cable vía",
                description="Máximo 25 racimos por viaje. Cuello de botella identificado.",
                source_excerpt="El cuello de botella principal es el transporte: cuando se acumula producto en cable vía, hay esperas largas",
                confidence_level="media", created_by="auto-extract",
                created_at=now(), updated_at=now(),
            ),
            ProcessAsIsElementModel(
                id=str(uuid.uuid4()), case_id=cosecha.id, interview_id=interview2.id,
                element_type="role", name="Supervisor de Calidad",
                description="Aplica criterios de aceptación: grado 39-42, longitud ≥8\", calibre 39-46mm",
                confidence_level="alta", created_by="auto-extract",
                created_at=now(), updated_at=now(),
            ),
            ProcessAsIsElementModel(
                id=str(uuid.uuid4()), case_id=cosecha.id, interview_id=interview2.id,
                element_type="event", name="Rechazo de lote por defectos de calidad",
                description="38% por sigatoka, 24% por daño mecánico, 18% inmadurez. Punto crítico de mejora.",
                source_excerpt="manchas por sigatoka (38%), daño mecánico de cable vía (24%), inmadurez (18%)",
                confidence_level="alta", created_by="auto-extract",
                created_at=now(), updated_at=now(),
            ),
        ]
        for el in as_is:
            db.add(el)
        db.commit()
        print(f"✅ 2 entrevistas y {len(as_is)} elementos AS-IS extraídos")

        # ─── 5. BPMN guardado en "Cosecha y Recolección" ───────────────────
        import hashlib
        repo = ProcessRepositoryModel(
            id=str(uuid.uuid4()), case_id=cosecha.id,
            name="Repositorio de Cosecha y Recolección",
            created_at=now(), updated_at=now(),
        )
        db.add(repo)
        db.flush()

        artifact = ProcessArtifactModel(
            id=str(uuid.uuid4()), repository_id=repo.id,
            artifact_type="bpmn",
            title="BPMN Cosecha y Recolección — AS-IS v1.0",
            description="Diagrama AS-IS del proceso de cosecha de banano en campo. "
                        "Levantado a partir de entrevistas con Jefe de Cosecha y Calidad.",
            created_at=now(), updated_at=now(),
        )
        db.add(artifact)
        db.flush()

        version = ArtifactVersionModel(
            id=str(uuid.uuid4()), artifact_id=artifact.id,
            version="1.0", status="active",
            content=BANANA_HARVEST_BPMN,
            change_summary="Versión inicial AS-IS del proceso de cosecha",
            author="Carlos Mendoza (Jefe de Cosecha)",
            content_hash=hashlib.sha256(BANANA_HARVEST_BPMN.encode()).hexdigest(),
            created_at=now(),
        )
        db.add(version)
        # Vincular artifact con version actual
        artifact.current_version_id = version.id
        # Actualizar map_status del caso
        cosecha.map_status = "documentado"
        cosecha.updated_at = now()
        db.commit()
        print(f"✅ BPMN guardado en '{cosecha.name}' (artifact id={artifact.id})")


        # ─── 7. BIBLIOTECA DE CONOCIMIENTO ─────────────────────────────────
        # NOTE: content/tags no son columnas — usamos chunks para el contenido
        from app.models.knowledge import KnowledgeChunkModel

        def make_doc(title, source_type, author, subject_area, filename):
            return KnowledgeDocumentModel(
                id=str(uuid.uuid4()),
                title=title,
                author=author,
                source_type=source_type,
                subject_area=subject_area,
                language="es",
                filename=filename,
                mime_type="text/markdown",
                file_path=f"seed://agroexport/{filename}",
                doc_category="methodology",
                status="processed",
                text_char_count=0,
                chunk_count=1,
                created_at=now(),
                updated_at=now(),
            )

        doc_contents = [
            (
                make_doc(
                    "Norma GlobalG.A.P. — Buenas Prácticas Agrícolas (resumen 2025)",
                    "standard", "GlobalG.A.P. Standard v6 (2025)",
                    "calidad-exportacion", "globalgap-v6-2025.md",
                ),
                "GlobalG.A.P. es el estándar privado más reconocido a nivel mundial para "
                "buenas prácticas agrícolas. Cubre seguridad alimentaria, sostenibilidad "
                "ambiental, bienestar laboral y bienestar animal. Para banano de exportación, "
                "los puntos críticos son: trazabilidad (lote, parcela, fecha de cosecha y de "
                "empaque), uso de fitosanitarios (registro completo, intervalos de seguridad), "
                "higiene en empacadora (limpieza diaria, control de plagas), bienestar laboral "
                "(contratos formales, EPP, agua potable), manejo de residuos. La auditoría es "
                "anual; la empresa debe mantener registros de los últimos 12 meses."
            ),
            (
                make_doc(
                    "Manual interno: Criterios de aceptación del banano de exportación",
                    "internal", "Gerencia de Calidad AgroExport",
                    "calidad-banano", "manual-criterios-banano-v3.2.md",
                ),
                "Manual interno AgroExport v3.2 (enero 2025). Grado de madurez: 39 a 42 "
                "(verde firme sin estriado amarillo); Aldi requiere 40-41 exclusivamente. "
                "Longitud dedos: mínimo 8 pulgadas (203 mm); premium Whole Foods/Carrefour Bio "
                "mínimo 9 pulgadas. Calibre: 39 a 46 mm; premium 40 a 44 mm. Defectos NO "
                "permitidos: tip rot, sigatoka, daño de pájaros, daño mecánico visible, "
                "decoloración por golpe, deformidad. Pencas completas: mínimo 4 dedos; premium "
                "mínimo 5. Peso por caja: 18.14 kg ± 0.5 kg tolerancia."
            ),
            (
                make_doc(
                    "Lean Manufacturing aplicado a empacadoras de banano",
                    "reference", "Adaptación a partir de literatura Lean",
                    "metodologia-lean", "lean-empacadora-banano.md",
                ),
                "El enfoque Lean en empacadoras de banano busca eliminar las 8 mudas: "
                "sobreproducción (producto se sobre-madura), espera (tiempos muertos entre "
                "cable vía y empacadora), transporte innecesario (mover producto que será "
                "rechazado), sobreproceso (re-lavar producto limpio), inventario (cajas "
                "armadas sin pedido), movimientos (cosecheros caminando sin valor), defectos "
                "(rechazo de lotes por defectos no detectados a tiempo), talento no "
                "aprovechado (conocimiento de cosecheros sin documentar). Herramientas: 5S en "
                "empacadora, poka-yoke en clasificación, kanban desde cable vía, andon para "
                "alertas en línea."
            ),
            (
                make_doc(
                    "Reporte de rechazos Q1-2026 — Calidad de cosecha",
                    "report", "Departamento de Calidad",
                    "reporte-calidad", "reporte-rechazos-q1-2026.md",
                ),
                "Reporte trimestral Q1-2026. Total cajas producidas: 248,500. Cajas "
                "rechazadas en empacadora: 18,420 (7.41%). Distribución de motivos: sigatoka "
                "38% (7,000 cajas), daño mecánico por cable vía 24% (4,421), inmadurez grado "
                "<39: 18% (3,316), calibre fuera de rango 12% (2,210), otros 8% (1,473). "
                "Impacto económico: USD 165,780 (precio FOB promedio 9.00 USD/caja). "
                "Recomendaciones: inspección visual previa en campo (ahorro potencial 24% de "
                "rechazos), programa de control fitosanitario reforzado para sigatoka, "
                "capacitación a cuadrillas de cable vía sobre manejo."
            ),
        ]

        for doc, content in doc_contents:
            doc.text_char_count = len(content)
            db.add(doc)
            db.flush()
            chunk = KnowledgeChunkModel(
                id=str(uuid.uuid4()),
                document_id=doc.id,
                chunk_index=0,
                content=content,
                char_start=0,
                char_end=len(content),
                created_at=now(),
            )
            db.add(chunk)
        db.commit()
        print(f"✅ {len(doc_contents)} documentos en biblioteca de conocimiento")

        # ─── 8. RESUMEN FINAL ──────────────────────────────────────────────
        print("\n" + "=" * 70)
        print("✅ SEED COMPLETADO — AgroExport Ecuador S.A.")
        print("=" * 70)
        print(f"  Empresa:        1 (AgroExport)")
        print(f"  Casos BPM:      {len(cases)} (9 N1 + 5 N2 + 4 N3)")
        print(f"  Stakeholders:   3 en 'Cosecha y Recolección'")
        print(f"  Entrevistas:    2")
        print(f"  Elementos AS-IS: {len(as_is)}")
        print(f"  BPMN guardado:  1 (Cosecha de Banano AS-IS v1.0)")
        print(f"  Documentos BC:  {len(doc_contents)}")
        print("=" * 70)

    except Exception as e:
        db.rollback()
        print(f"❌ Error en seed: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
