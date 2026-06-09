import { useEffect, useRef } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import {
  BpmnPropertiesPanelModule,
  BpmnPropertiesProviderModule,
  ZeebePropertiesProviderModule,
} from 'bpmn-js-properties-panel';
import zeebeModdle from 'zeebe-bpmn-moddle/resources/zeebe.json';

export function useBpmnModeler(
  containerRef: React.RefObject<HTMLDivElement | null>,
  propertiesPanelRef: React.RefObject<HTMLDivElement | null>,
) {
  const modelerRef = useRef<InstanceType<typeof BpmnModeler> | null>(null);

  useEffect(() => {
    if (!containerRef.current || !propertiesPanelRef.current) return;

    const m = new BpmnModeler({
      container: containerRef.current,
      propertiesPanel: { parent: propertiesPanelRef.current },
      additionalModules: [
        BpmnPropertiesPanelModule,
        BpmnPropertiesProviderModule,
        ZeebePropertiesProviderModule,
      ],
      moddleExtensions: { zeebe: zeebeModdle },
    });
    modelerRef.current = m;

    return () => {
      m.destroy();
      modelerRef.current = null;
    };
  }, [containerRef, propertiesPanelRef]);

  return modelerRef;
}
