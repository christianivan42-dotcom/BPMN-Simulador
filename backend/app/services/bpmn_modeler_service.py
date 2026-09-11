import html
import re
from uuid import UUID
from xml.etree import ElementTree

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.discovery import ProcessAsIsElementModel
from app.models.process_case import ProcessCaseModel
from app.schemas.bpmn import (
    BpmnDraftResponse,
    BpmnGenerateCreate,
    BpmnIssueResponse,
    BpmnIssueSeverity,
    BpmnValidationResponse,
)
from app.schemas.discovery import AsIsElementType
from app.schemas.process_repository import ArtifactType, ProcessArtifactCreate
from app.services.process_repository_service import ProcessRepositoryService


class BpmnModelerService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def generate_as_is_bpmn(
        self,
        case_id: UUID,
        payload: BpmnGenerateCreate | None = None,
    ) -> BpmnDraftResponse | None:
        process_case = self.db.get(ProcessCaseModel, str(case_id))
        if process_case is None:
            return None

        elements = self._as_is_elements(case_id)
        xml = self._build_bpmn_xml(process_case, elements)
        validation = self.validate_bpmn(xml)
        task_count = len([element for element in elements if element.element_type == AsIsElementType.activity.value])
        gateway_count = len([element for element in elements if element.element_type == AsIsElementType.business_rule.value])
        artifact_id = None
        artifact_version_id = None

        if payload and payload.persist:
            artifact = ProcessRepositoryService(self.db).create_artifact(
                case_id,
                ProcessArtifactCreate(
                    artifact_type=ArtifactType.bpmn_xml_as_is,
                    title=payload.title,
                    description="BPMN XML as-is generado desde elementos levantados por el agente.",
                    content=xml,
                    version="0.1.0",
                    change_summary="Generacion inicial automatica desde inventario as-is.",
                    author=payload.author,
                ),
            )
            if artifact:
                artifact_id = artifact.id
                artifact_version_id = artifact.versions[0].id if artifact.versions else None

        return BpmnDraftResponse(
            case_id=UUID(process_case.id),
            source_element_count=len(elements),
            task_count=task_count,
            gateway_count=gateway_count,
            bpmn_xml=xml,
            issues=validation.issues,
            is_valid=validation.is_valid,
            artifact_id=artifact_id,
            artifact_version_id=artifact_version_id,
        )

    def preview_as_is_bpmn(self, case_id: UUID) -> BpmnDraftResponse | None:
        return self.generate_as_is_bpmn(case_id, BpmnGenerateCreate(persist=False))

    def validate_bpmn(self, bpmn_xml: str) -> BpmnValidationResponse:
        issues: list[BpmnIssueResponse] = []
        try:
            root = ElementTree.fromstring(bpmn_xml)
        except ElementTree.ParseError as error:
            return BpmnValidationResponse(
                is_valid=False,
                issues=[
                    BpmnIssueResponse(
                        severity=BpmnIssueSeverity.error,
                        code="xml_parse_error",
                        message_es=f"El XML BPMN no es parseable: {error}.",
                    )
                ],
            )

        namespace = self._namespace(root.tag)
        process = root.find(f".//{{{namespace}}}process") if namespace else root.find(".//process")
        if process is None:
            issues.append(self._issue("error", "missing_process", "Falta elemento process en BPMN."))
            return BpmnValidationResponse(is_valid=False, issues=issues)

        children = list(process)
        element_ids = {child.attrib.get("id") for child in children if child.attrib.get("id")}
        start_events = self._children_by_suffix(children, "startEvent")
        end_events = self._children_by_suffix(children, "endEvent")
        tasks = self._children_by_suffix(children, "task")
        gateways = self._children_by_suffix(children, "exclusiveGateway")
        sequence_flows = self._children_by_suffix(children, "sequenceFlow")

        if not start_events:
            issues.append(self._issue("error", "missing_start_event", "El BPMN debe tener evento de inicio."))
        if not end_events:
            issues.append(self._issue("error", "missing_end_event", "El BPMN debe tener evento de fin."))
        if not tasks:
            issues.append(self._issue("warning", "missing_tasks", "El BPMN no contiene tareas de actividad."))

        for task in tasks:
            if not task.attrib.get("name"):
                issues.append(self._issue("error", "task_without_name", "Una tarea no tiene nombre.", task.attrib.get("id")))

        for flow in sequence_flows:
            source = flow.attrib.get("sourceRef")
            target = flow.attrib.get("targetRef")
            if source not in element_ids:
                issues.append(self._issue("error", "invalid_source_ref", "Un sequenceFlow referencia sourceRef inexistente.", flow.attrib.get("id")))
            if target not in element_ids:
                issues.append(self._issue("error", "invalid_target_ref", "Un sequenceFlow referencia targetRef inexistente.", flow.attrib.get("id")))

        outgoing_by_node: dict[str, int] = {}
        incoming_by_node: dict[str, int] = {}
        for flow in sequence_flows:
            source = flow.attrib.get("sourceRef")
            target = flow.attrib.get("targetRef")
            if source:
                outgoing_by_node[source] = outgoing_by_node.get(source, 0) + 1
            if target:
                incoming_by_node[target] = incoming_by_node.get(target, 0) + 1

        for gateway in gateways:
            gateway_id = gateway.attrib.get("id")
            if gateway_id and outgoing_by_node.get(gateway_id, 0) < 2:
                issues.append(
                    self._issue(
                        "warning",
                        "gateway_without_alternatives",
                        "Un gateway exclusivo deberia tener al menos dos salidas.",
                        gateway_id,
                    )
                )

        for element_id in element_ids:
            if element_id in {event.attrib.get("id") for event in start_events}:
                continue
            if element_id in {event.attrib.get("id") for event in end_events}:
                continue
            if incoming_by_node.get(element_id, 0) == 0:
                issues.append(self._issue("warning", "orphan_incoming", "Elemento sin flujo entrante.", element_id))
            if outgoing_by_node.get(element_id, 0) == 0:
                issues.append(self._issue("warning", "orphan_outgoing", "Elemento sin flujo saliente.", element_id))

        is_valid = not any(issue.severity == BpmnIssueSeverity.error for issue in issues)
        if is_valid and not issues:
            issues.append(self._issue("info", "valid_basic_bpmn", "Validacion basica BPMN superada."))
        return BpmnValidationResponse(is_valid=is_valid, issues=issues)

    def _as_is_elements(self, case_id: UUID) -> list[ProcessAsIsElementModel]:
        statement = (
            select(ProcessAsIsElementModel)
            .where(ProcessAsIsElementModel.case_id == str(case_id))
            .order_by(ProcessAsIsElementModel.created_at.asc())
        )
        return list(self.db.scalars(statement).all())

    def _build_bpmn_xml(
        self,
        process_case: ProcessCaseModel,
        elements: list[ProcessAsIsElementModel],
    ) -> str:
        activities = [element for element in elements if element.element_type == AsIsElementType.activity.value]
        rules = [element for element in elements if element.element_type == AsIsElementType.business_rule.value]
        exceptions = [element for element in elements if element.element_type == AsIsElementType.exception.value]

        if not activities:
            fallback_name = process_case.objective or process_case.name
            activities = [
                ProcessAsIsElementModel(
                    id="fallback",
                    case_id=process_case.id,
                    element_type=AsIsElementType.activity.value,
                    name=fallback_name[:180],
                    confidence_level="low",
                    created_by="bpmn_modeler",
                )
            ]

        nodes: list[tuple[str, str, str]] = [("start", "startEvent", "Inicio")]
        for index, activity in enumerate(activities, start=1):
            nodes.append((f"task_{index}", "task", activity.name))
            if index == 1 and rules:
                nodes.append(("gateway_rules", "exclusiveGateway", "Decision de regla"))
        if exceptions:
            nodes.append(("task_exception", "task", "Gestionar excepcion"))
        nodes.append(("end", "endEvent", "Fin"))

        flows: list[tuple[str, str, str, str | None]] = []
        previous_id = nodes[0][0]
        flow_index = 1
        for node_id, node_type, _ in nodes[1:]:
            if previous_id == "gateway_rules":
                flows.append((f"flow_{flow_index}", previous_id, node_id, "Cumple regla"))
                flow_index += 1
            else:
                flows.append((f"flow_{flow_index}", previous_id, node_id, None))
                flow_index += 1
            if node_id == "gateway_rules" and len(nodes) > 3:
                exception_target = "task_exception" if exceptions else "end"
                flows.append((f"flow_{flow_index}", node_id, exception_target, "No cumple regla"))
                flow_index += 1
            previous_id = node_id

        process_id = self._xml_id(f"process_{process_case.id.replace('-', '_')}")
        process_name = html.escape(process_case.name)
        node_xml = "\n".join(self._node_xml(node_id, node_type, name) for node_id, node_type, name in nodes)
        flow_xml = "\n".join(self._flow_xml(flow_id, source, target, name) for flow_id, source, target, name in flows)
        documentation = self._documentation(elements, rules, exceptions)

        return f"""<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  id="definitions_{process_id}"
                  targetNamespace="http://agente-ia-prueba/bpmn">
  <bpmn:process id="{process_id}" name="{process_name}" isExecutable="false">
{documentation}
{node_xml}
{flow_xml}
  </bpmn:process>
</bpmn:definitions>
"""

    @staticmethod
    def _node_xml(node_id: str, node_type: str, name: str) -> str:
        return f'    <bpmn:{node_type} id="{node_id}" name="{html.escape(name)}" />'

    @staticmethod
    def _flow_xml(flow_id: str, source: str, target: str, name: str | None) -> str:
        name_attr = f' name="{html.escape(name)}"' if name else ""
        return f'    <bpmn:sequenceFlow id="{flow_id}" sourceRef="{source}" targetRef="{target}"{name_attr} />'

    @staticmethod
    def _documentation(
        elements: list[ProcessAsIsElementModel],
        rules: list[ProcessAsIsElementModel],
        exceptions: list[ProcessAsIsElementModel],
    ) -> str:
        lines = [
            f"Generado por Agente Modelador BPMN desde {len(elements)} elemento(s) as-is.",
            f"Reglas detectadas: {len(rules)}.",
            f"Excepciones detectadas: {len(exceptions)}.",
        ]
        content = html.escape(" ".join(lines))
        return f"    <bpmn:documentation>{content}</bpmn:documentation>"

    @staticmethod
    def _namespace(tag: str) -> str:
        match = re.match(r"\{(.+)}", tag)
        return match.group(1) if match else ""

    @staticmethod
    def _children_by_suffix(children: list[ElementTree.Element], suffix: str) -> list[ElementTree.Element]:
        return [child for child in children if child.tag.endswith(suffix)]

    @staticmethod
    def _xml_id(value: str) -> str:
        cleaned = re.sub(r"[^A-Za-z0-9_]+", "_", value)
        if not cleaned or cleaned[0].isdigit():
            cleaned = f"id_{cleaned}"
        return cleaned

    @staticmethod
    def _issue(
        severity: str,
        code: str,
        message: str,
        element_ref: str | None = None,
    ) -> BpmnIssueResponse:
        return BpmnIssueResponse(
            severity=BpmnIssueSeverity(severity),
            code=code,
            message_es=message,
            element_ref=element_ref,
        )
