import { useMemo } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { CompoundBrep } from "../geometry";
import { isDescendantOf, collectPickableMeshes } from "../scene-operations/mesh-operations";

interface UseUngroupModeResult {
  handleUngroupModeClick: (event: MouseEvent) => void;
  performUngroup: () => void;
  canUngroup: boolean;
}

export function useUngroupMode(): UseUngroupModeResult {
  const {
    selectElement,
    deselectElement,
    elements,
    getObject,
    selectedElements,
    ungroupSelectedElement,
  } = useCadCore();

  const {
    camera,
    renderer,
    scene,
    forceSceneUpdate,
    highlightElement,
    unhighlightElement,
  } = useCadVisualizer();

  const canUngroup = useMemo(() => {
    if (selectedElements.length !== 1) return false;

    const selectedElement = elements.find(
      (el) => el.nodeId === selectedElements[0]
    );

    if (!selectedElement) return false;

    return (
      selectedElement.brep instanceof CompoundBrep ||
      ("children" in selectedElement.brep &&
        Array.isArray((selectedElement.brep as any).children) &&
        (selectedElement.brep as any).children.length > 0)
    );
  }, [selectedElements, elements]);

  const handleUngroupModeClick = (event: MouseEvent) => {
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
          selectedElements.forEach((id) => {
            deselectElement(id);
            unhighlightElement(id);
          });

          selectElement(el.nodeId);
          highlightElement(el.nodeId);
          break;
        }
      }
    }
  };

  const performUngroup = () => {
    if (canUngroup) {
      ungroupSelectedElement();
      forceSceneUpdate();
    }
  };

  return {
    handleUngroupModeClick,
    performUngroup,
    canUngroup,
  };
}
