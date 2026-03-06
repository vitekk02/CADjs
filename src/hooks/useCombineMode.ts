import { useState, useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { useToast } from "../contexts/ToastContext";
import { isDescendantOf, collectPickableMeshes } from "../scene-operations/mesh-operations";
import { isElement3D, CombineOperationType } from "../scene-operations/types";
import { COMBINE, BODY } from "../theme";

export interface UseCombineModeResult {
  handleCombineMouseDown: (event: MouseEvent) => void;
  handleCombineMouseMove: (event: MouseEvent) => void;
  performCombine: () => Promise<void>;
  canCombine: boolean;
  operationType: CombineOperationType;
  setOperationType: (type: CombineOperationType) => void;
  targetBody: string | null;
  toolBodies: string[];
  keepTools: boolean;
  setKeepTools: (keep: boolean) => void;
  resetSelection: () => void;
}

export function useCombineMode(): UseCombineModeResult {
  const {
    elements,
    getObject,
    mode,
    combineSelectedElements,
  } = useCadCore();

  const {
    camera,
    renderer,
    navToolActiveRef,
    forceSceneUpdate,
  } = useCadVisualizer();

  const { showToast } = useToast();

  const [operationType, setOperationTypeRaw] = useState<CombineOperationType>("join");
  const [targetBody, setTargetBody] = useState<string | null>(null);
  const [toolBodies, setToolBodies] = useState<string[]>([]);
  const [keepTools, setKeepTools] = useState(false);
  const hoveredRef = useRef<string | null>(null);

  const setOperationType = useCallback((type: CombineOperationType) => {
    setOperationTypeRaw(type);
    if (type === "join") setKeepTools(false);
  }, []);

  const canCombine = targetBody !== null && toolBodies.length >= 1;

  const setElementColor = useCallback((nodeId: string, color: number) => {
    const obj = getObject(nodeId);
    if (!obj) return;
    obj.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        !child.userData.isEdgeOverlay &&
        !child.userData.isHelper
      ) {
        (child.material as THREE.MeshStandardMaterial).color.set(color);
      }
    });
  }, [getObject]);

  const resetAllColors = useCallback(() => {
    if (targetBody) setElementColor(targetBody, BODY.default);
    toolBodies.forEach((id) => setElementColor(id, BODY.default));
    if (hoveredRef.current) {
      setElementColor(hoveredRef.current, BODY.default);
      hoveredRef.current = null;
    }
  }, [targetBody, toolBodies, setElementColor]);

  const resetSelection = useCallback(() => {
    resetAllColors();
    setTargetBody(null);
    setToolBodies([]);
  }, [resetAllColors]);

  // Reset when mode changes away from combine
  useEffect(() => {
    if (mode !== "combine") {
      resetAllColors();
      setTargetBody(null);
      setToolBodies([]);
      hoveredRef.current = null;
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const findClickedElement = useCallback((event: MouseEvent): string | null => {
    if (!renderer || !camera) return null;

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
          if (!isElement3D(el)) return null;
          return el.nodeId;
        }
      }
    }
    return null;
  }, [renderer, camera, elements, getObject]);

  const handleCombineMouseDown = useCallback((event: MouseEvent) => {
    if (event.button !== 0 || event.altKey || navToolActiveRef.current) return;

    const clickedId = findClickedElement(event);
    if (!clickedId) return;

    if (!targetBody) {
      // First click: set target
      setTargetBody(clickedId);
      setElementColor(clickedId, COMBINE.targetHighlight);
    } else if (clickedId === targetBody) {
      // Click on existing target: deselect
      setElementColor(clickedId, BODY.default);
      setTargetBody(null);
    } else if (toolBodies.includes(clickedId)) {
      // Click on existing tool: remove
      setElementColor(clickedId, BODY.default);
      setToolBodies((prev) => prev.filter((id) => id !== clickedId));
    } else {
      // Click on new body: add as tool
      setToolBodies((prev) => [...prev, clickedId]);
      setElementColor(clickedId, COMBINE.toolHighlight);
    }
  }, [targetBody, toolBodies, findClickedElement, setElementColor, navToolActiveRef]);

  const handleCombineMouseMove = useCallback((event: MouseEvent) => {
    const hoveredId = findClickedElement(event);

    // Clear previous hover if different
    const prevHovered = hoveredRef.current;
    if (prevHovered && prevHovered !== hoveredId) {
      // Only reset if not target or tool
      if (prevHovered !== targetBody && !toolBodies.includes(prevHovered)) {
        setElementColor(prevHovered, BODY.default);
      }
    }

    // Apply hover if not already target/tool
    if (hoveredId && hoveredId !== targetBody && !toolBodies.includes(hoveredId)) {
      const hoverColor = !targetBody ? COMBINE.targetHover : COMBINE.toolHover;
      setElementColor(hoveredId, hoverColor);
    }

    hoveredRef.current = hoveredId;
  }, [findClickedElement, targetBody, toolBodies, setElementColor]);

  const performCombine = useCallback(async () => {
    if (!canCombine || !targetBody) return;

    const currentToolBodies = [...toolBodies];
    const success = await combineSelectedElements(operationType, {
      targetId: targetBody,
      toolIds: currentToolBodies,
      keepTools,
    });

    if (!success) {
      const opName = operationType === "join" ? "Join" : operationType === "cut" ? "Cut" : "Intersect";
      showToast(`${opName} operation failed`, "error");
      // Reset colors on failure
      resetAllColors();
    } else if (keepTools) {
      // Tool bodies survived — reset their color to default
      currentToolBodies.forEach((id) => setElementColor(id, BODY.default));
    }

    // Reset combine state
    setTargetBody(null);
    setToolBodies([]);
    hoveredRef.current = null;
    forceSceneUpdate();
  }, [canCombine, targetBody, toolBodies, operationType, keepTools, combineSelectedElements, showToast, forceSceneUpdate, resetAllColors, setElementColor]);

  return {
    handleCombineMouseDown,
    handleCombineMouseMove,
    performCombine,
    canCombine,
    operationType,
    setOperationType,
    targetBody,
    toolBodies,
    keepTools,
    setKeepTools,
    resetSelection,
  };
}
