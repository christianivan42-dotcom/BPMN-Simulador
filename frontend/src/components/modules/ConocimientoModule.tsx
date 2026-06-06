import { BookOpen } from "lucide-react";
import { ObsidianGraph } from "../ObsidianGraph";
import type { Company } from "../../api";

/**
 * ConocimientoModule — mapa de conocimiento: grafica la organización a partir de
 * su mapa de procesos y los diagramas BPMN (AS-IS / TO-BE) modelados.
 */
export function ConocimientoModule({ company }: { company: Company }) {
  return (
    <div className="conocimiento-module">
      <header className="modeler-header">
        <div>
          <h1><BookOpen size={22} style={{ verticalAlign: "middle", marginRight: 8 }} />Conocimiento</h1>
          <p className="muted">Mapa de conocimiento: empresa → procesos del mapa → diagramas BPMN</p>
        </div>
      </header>

      <div className="conocimiento-content">
        <ObsidianGraph company={company} />
      </div>
    </div>
  );
}
