import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";

interface UseDifferenceModeResult {
  handleDifferenceModeClick: (event: MouseEvent) => void;
  performDifference: () => void;
  canDifference: boolean;
  selectedCount: number;
}

// first selected = base, rest get subtracted
export function useDifferenceMode(): UseDifferenceModeResult {
  const {
    selectElement,
    deselectElement,
    elements,
    getObject,
    selectedElements,
    differenceSelectedElements,
  } = useCadCore();

  const {
    camera,
    renderer,
    forceSceneUpdate,
    highlightElement,
    unhighlightElement,
  } = useCadVisualizer();

  const canDifference = selectedElements.length >= 2;
  const selectedCount = selectedElements.length;

  const handleDifferenceModeClick = (event: MouseEvent) => {
    if (event.button !== 0 || !renderer || !camera) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
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

  const performDifference = () => {
    if (canDifference) {
      differenceSelectedElements();
      forceSceneUpdate();
    }
  };

  return {
    handleDifferenceModeClick,
    performDifference,
    canDifference,
    selectedCount,
  };
}
