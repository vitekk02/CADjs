import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { useToast } from "../contexts/ToastContext";
import { isDescendantOf, collectPickableMeshes } from "../scene-operations/mesh-operations";
import { isElement3D } from "../scene-operations/types";

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

  const { showToast } = useToast();

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

  const performDifference = async () => {
    if (canDifference) {
      const success = await differenceSelectedElements();
      if (!success) {
        showToast("Difference operation failed", "error");
      }
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
