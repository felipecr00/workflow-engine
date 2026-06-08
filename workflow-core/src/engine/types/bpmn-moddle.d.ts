declare module "bpmn-moddle" {
  interface BpmnModdleResult {
    rootElement: unknown;
    elementsById?: Record<string, unknown>;
    references?: unknown[];
    warnings?: unknown[];
  }

  export default class BpmnModdle {
    constructor(packages?: Record<string, unknown>, options?: Record<string, unknown>);
    fromXML(xml: string, typeName?: string): Promise<BpmnModdleResult>;
    toXML(element: unknown, options?: Record<string, unknown>): Promise<{ xml: string }>;
    create<T = unknown>(type: string, attrs?: Record<string, unknown>): T;
  }
}
