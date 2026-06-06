import { BookOpen } from "lucide-react";
import { ObsidianGraph } from "../ObsidianGraph";

/**
 * ConocimientoModule — solo el mapa de conocimiento de los nodos.
 * (Se retiraron Biblioteca, Knowledge Graph y Búsqueda semántica en el rediseño.)
 */
export function ConocimientoModule() {
  return (
    <div className="conocimiento-module">
      <header className="modeler-header">
        <div>
          <h1><BookOpen size={22} style={{ verticalAlign: "middle", marginRight: 8 }} />Conocimiento</h1>
          <p className="muted">Mapa de conocimiento de los nodos</p>
        </div>
      </header>

      <div className="conocimiento-content">
        <ObsidianGraph />
      </div>
    </div>
  );
}
