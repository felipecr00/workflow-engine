import { useEffect, useRef } from 'react';
import BpmnViewer from 'bpmn-js/lib/NavigatedViewer';
import zeebeModdle from 'zeebe-bpmn-moddle/resources/zeebe.json';

export function useBpmnViewer(
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const viewerRef = useRef<InstanceType<typeof BpmnViewer> | null>(null);

  const mount = async (xml: string) => {
    if (!containerRef.current) return null;

    if (viewerRef.current) {
      viewerRef.current.destroy();
      viewerRef.current = null;
    }

    const viewer = new BpmnViewer({
      container: containerRef.current,
      moddleExtensions: { zeebe: zeebeModdle },
    });
    await viewer.importXML(xml);
    (viewer.get('canvas') as any).zoom('fit-viewport');
    viewerRef.current = viewer;
    return viewer;
  };

  useEffect(() => {
    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  return { viewerRef, mount };
}
