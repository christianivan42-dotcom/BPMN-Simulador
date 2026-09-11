import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BpmnViewer } from "./BpmnViewer";

interface ChatMarkdownProps {
  content: string;
}

/** Detecta si una cadena contiene XML BPMN (con o sin namespace prefix) */
export function hasBpmnXml(content: string): boolean {
  // Namespaced BPMN (formato correcto con prefijo bpmn:)
  if (
    content.includes("bpmn:definitions") ||
    content.includes("bpmn2:definitions") ||
    content.includes("xmlns:bpmn=") ||
    content.includes("omg.org/spec/BPMN")
  ) return true;

  // Plain BPMN sin namespace prefix (LLMs que no siguen el formato estricto)
  if (
    content.includes("<definitions") &&
    (content.includes("<process") ||
      content.includes("<startEvent") ||
      content.includes("<endEvent") ||
      content.includes("<sequenceFlow"))
  ) return true;

  return false;
}

const components: Components = {
  code({ className, children }) {
    const raw = String(children).replace(/\n$/, "");
    const lang = (className ?? "").replace("language-", "");

    // Bloque BPMN: detectar por lenguaje declarado o por contenido
    const isBpmn =
      lang === "bpmn" ||
      (lang === "xml" && hasBpmnXml(raw)) ||
      hasBpmnXml(raw);

    if (isBpmn) {
      return (
        <div className="chat-bpmn-block">
          <p className="chat-bpmn-label">Diagrama BPMN 2.0</p>
          <BpmnViewer xml={raw} height={400} />
        </div>
      );
    }

    // Código inline sin bloque
    if (!className) {
      return <code className="chat-inline-code">{children}</code>;
    }

    // Bloque de código normal
    return (
      <pre className="chat-code-block">
        <code className={className}>{children}</code>
      </pre>
    );
  },
};

export function ChatMarkdown({ content }: ChatMarkdownProps) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
