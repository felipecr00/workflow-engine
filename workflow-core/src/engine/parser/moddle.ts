// bpmn-moddle has no bundled TS types. Wrap it in a tiny typed surface so the
// rest of the engine doesn't need to interact with `any`.
import BpmnModdle from "bpmn-moddle";
import { zeebeDescriptor } from "./zeebe-descriptor";

export interface ModdleElement {
  $type: string;
  id?: string;
  [key: string]: unknown;
}

export interface ParsedXml {
  rootElement: ModdleElement;
  warnings: unknown[];
}

let moddleInstance: BpmnModdle | null = null;

function getModdle(): BpmnModdle {
  if (!moddleInstance) {
    moddleInstance = new BpmnModdle({ zeebe: zeebeDescriptor });
  }
  return moddleInstance;
}

export async function parseXml(xml: string): Promise<ParsedXml> {
  const moddle = getModdle();
  const result = await moddle.fromXML(xml);
  return {
    rootElement: result.rootElement as unknown as ModdleElement,
    warnings: result.warnings ?? [],
  };
}
