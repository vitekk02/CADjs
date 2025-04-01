// src/hooks/useUnionMode.ts
import { useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";

interface UseUnionModeResult {
  // Event handler for union mode
  handleUnionModeClick: (event: MouseEvent) => void;

  // Function to perform the union operation
  performUnion: () => void;

  // Check if union can be performed (2+ elements selected)
  canUnion: boolean;
}

export function useUnionMode(): UseUnionModeResult {
  const {
    selectElement,
    deselectElement,
    elements,
    getObject,
    selectedElements,
    unionSelectedElements,
  } = useCadCore();

  const {
    camera,
    renderer,
    scene,
    forceSceneUpdate,
    highlightElement,
    unhighlightElement,
  } = useCadVisualizer();

  // State to track if union can be performed (2+ elements selected)
  const canUnion = selectedElements.length >= 2;

  // Handle click in union mode - toggle element selection
  const handleUnionModeClick = (event: MouseEvent) => {
    if (event.button !== 0 || !renderer || !camera) return; // Left mouse button only

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
          // Toggle selection
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

  // Function to perform the union operation
  const performUnion = () => {
    if (canUnion) {
      unionSelectedElements();
      forceSceneUpdate();
    }
  };

  return {
    handleUnionModeClick,
    performUnion,
    canUnion,
  };
}
