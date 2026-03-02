import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { useToast } from "../contexts/ToastContext";
import { isDescendantOf, collectPickableMeshes } from "../scene-operations/mesh-operations";
import { isElement3D } from "../scene-operations/types";

interface UseIntersectionModeResult {
  handleIntersectionModeClick: (event: MouseEvent) => void;

  performIntersection: () => void;

  canIntersect: boolean;
}

export function useIntersectionMode(): UseIntersectionModeResult {
  const {
    selectElement,
    deselectElement,
    elements,
    getObject,
    selectedElements,
    intersectionSelectedElements,
  } = useCadCore();

  const {
    camera,
    renderer,
    forceSceneUpdate,
    highlightElement,
    unhighlightElement,
    navToolActiveRef,
  } = useCadVisualizer();

  const { showToast } = useToast();

  const canIntersect = selectedElements.length >= 2;

  const handleIntersectionModeClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.altKey || navToolActiveRef.current || !renderer || !camera) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const meshes = collectPickableMeshes(elements, getObject);
    const intersects = raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
      const pickedObject = intersects[0].object;

      for (const el of elements) {
        const obj = getObject(el.nodeId);
        if (obj && isDescendantOf(pickedObject, obj)) {
          if (!isElement3D(el)) break;

          if (selectedElements.includes(el.nodeId)) {
            deselectElement(el.nodeId);
            unhighlightElement(el.nodeId);
          } else {
            selectElement(el.nodeId);
            highlightElement(el.nodeId);
          }
          break;
        }
      }
    }
  };

  const performIntersection = async () => {
    if (canIntersect) {
      const success = await intersectionSelectedElements();
      if (!success) {
        showToast("Intersection operation failed", "error");
      }
      forceSceneUpdate();
    }
  };

  return {
    handleIntersectionModeClick,
    performIntersection,
    canIntersect,
  };
}
