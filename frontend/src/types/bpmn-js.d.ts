declare module "bpmn-js" {
  interface Canvas {
    zoom(fit: string | number, center?: string): void;
  }
  interface BpmnJSOptions {
    container?: HTMLElement;
    keyboard?: { bindTo?: Document | HTMLElement };
    propertiesPanel?: { parent?: HTMLElement };
    additionalModules?: unknown[];
    moddleExtensions?: Record<string, unknown>;
  }
  interface ImportResult { warnings: unknown[] }

  class BpmnViewer {
    constructor(options: BpmnJSOptions);
    importXML(xml: string): Promise<ImportResult>;
    get(name: "canvas"): Canvas;
    destroy(): void;
    attachTo(el: HTMLElement): void;
  }
  export default BpmnViewer;
}

declare module "bpmn-js-properties-panel" {
  export const BpmnPropertiesPanelModule: unknown;
  export const BpmnPropertiesProviderModule: unknown;
  export const CamundaPlatformPropertiesProviderModule: unknown;
  export const ZeebePropertiesProviderModule: unknown;
}

declare module "diagram-js-minimap" {
  const minimapModule: unknown;
  export default minimapModule;
}

declare module "bpmn-js-color-picker" {
  const colorPickerModule: unknown;
  export default colorPickerModule;
}

declare module "camunda-bpmn-moddle/resources/camunda.json" {
  const value: unknown;
  export default value;
}

declare module "bpmn-js/lib/Modeler" {
  import BpmnViewer from "bpmn-js";
  interface SaveXMLOptions { format?: boolean; preamble?: boolean }
  interface SaveXMLResult  { xml: string }
  interface SaveSVGResult  { svg: string }

  class BpmnModeler extends BpmnViewer {
    saveXML(options?: SaveXMLOptions): Promise<SaveXMLResult>;
    saveSVG(): Promise<SaveSVGResult>;
    get(name: "canvas"): import("bpmn-js").Canvas;
    get(name: "commandStack"): { undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean };
    get(name: "eventBus"): { on(event: string, cb: (e: unknown) => void): void };
    get(name: "selection"): { get(): unknown[] };
    get(name: "modeling"): { updateProperties(element: unknown, props: Record<string, unknown>): void };
    get(name: "overlays"): {
      add(elementId: string, type: string, config: unknown): string;
      remove(filter: { type: string } | string): void;
      clear(): void;
    };
    get(name: "elementRegistry"): {
      getAll(): Array<{ id: string; type: string; businessObject?: { sourceRef?: { id: string }; targetRef?: { id: string }; name?: string } }>;
      get(id: string): unknown;
    };
    get(name: "minimap"): { open(): void; close(): void; toggle(): void };
    get(name: string): unknown;
  }
  export default BpmnModeler;
}
