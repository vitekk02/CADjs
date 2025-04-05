// src/hooks/useUngroupMode.ts
import { useMemo } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { CompoundBrep } from "../geometry";

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

  // Check if the selected element contains a CompoundBrep
  const canUngroup = useMemo(() => {
    if (selectedElements.length !== 1) return false;

    const selectedElement = elements.find(
      (el) => el.nodeId === selectedElements[0]
    );

    if (!selectedElement) return false;

    // Check if it's a compound brep
    return (
      selectedElement.brep instanceof CompoundBrep ||
      ("children" in selectedElement.brep &&
        Array.isArray((selectedElement.brep as any).children) &&
        (selectedElement.brep as any).children.length > 0)
    );
  }, [selectedElements, elements]);

  // Handle click in ungroup mode - select a compound object
  const handleUngroupModeClick = (event: MouseEvent) => {
    if (event.button !== 0 || !renderer || !camera) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // Create array of objects for intersection test
    const objects: THREE.Object3D[] = [];
    elements.forEach((el) => {
      const obj = getObject(el.nodeId);
      if (obj) objects.push(obj);
    });

    const intersects = raycaster.intersectObjects(objects, true);

    if (intersects.length > 0) {
      const pickedObject = intersects[0].object;

      // Find the element this object belongs to
      for (const el of elements) {
        const obj = getObject(el.nodeId);
        if (
          obj === pickedObject ||
          (pickedObject.parent && obj === pickedObject.parent)
        ) {
          // Clear previous selection
          selectedElements.forEach((id) => {
            deselectElement(id);
            unhighlightElement(id);
          });

          // Select this element
          selectElement(el.nodeId);
          highlightElement(el.nodeId);
          break;
        }
      }
    }
  };

  // Function to perform the ungroup operation
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
