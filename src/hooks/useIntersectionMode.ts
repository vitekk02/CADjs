import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";

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
  } = useCadVisualizer();

  const canIntersect = selectedElements.length >= 2;

  const handleIntersectionModeClick = (event: MouseEvent) => {
    if (event.button !== 0 || !renderer || !camera) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const objects: THREE.Object3D[] = [];
    elements.forEach((el) => {
      const obj = getObject(el.nodeId);
      if (obj) objects.push(obj);
    });

    const intersects = raycaster.intersectObjects(objects, true);

    if (intersects.length > 0) {
      const pickedObject = intersects[0].object;

      for (const el of elements) {
        const obj = getObject(el.nodeId);
        if (
          obj === pickedObject ||
          (pickedObject.parent && obj === pickedObject.parent)
        ) {
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

  const performIntersection = () => {
    if (canIntersect) {
      intersectionSelectedElements();
      forceSceneUpdate();
    }
  };

  return {
    handleIntersectionModeClick,
    performIntersection,
    canIntersect,
  };
}
