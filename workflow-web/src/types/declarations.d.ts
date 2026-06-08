declare module "*.css" {
  const content: string;
  export default content;
}

declare module "zeebe-bpmn-moddle/resources/zeebe.json" {
  const descriptor: Record<string, unknown>;
  export default descriptor;
}

declare module "bpmn-js-properties-panel" {
  export const BpmnPropertiesPanelModule: Record<string, unknown>;
  export const BpmnPropertiesProviderModule: Record<string, unknown>;
  export const ZeebePropertiesProviderModule: Record<string, unknown>;
  export function useService(type: string, strict?: boolean): unknown;
}
