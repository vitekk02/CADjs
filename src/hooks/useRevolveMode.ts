import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { useToast } from "../contexts/ToastContext";
import { Brep } from "../geometry";
import { revolveBRep } from "../scene-operations/revolve-operations";
import { isDescendantOf, collectPickableMeshes } from "../scene-operations/mesh-operations";
import { REVOLVE, BODY, SELECTION } from "../theme";

export type RevolvePhase = "SELECT_PROFILE" | "SELECT_AXIS" | "SET_ANGLE";

interface RevolveState {
  phase: RevolvePhase;
  selectedElement: string | null;
  axisEdgeStart: THREE.Vector3 | null;
  axisEdgeEnd: THREE.Vector3 | null;
  angle: number;
  isApplying: boolean;
  showDimensionInput: boolean;
  dimensionInputPosition: { x: number; y: number };
}

interface EdgeSegmentData {
  edgeIndex: number;
  segments: Float32Array;
  midpoint: { x: number; y: number; z: number };
}

/**
 * Hook for Fusion 360-style revolve mode.
 * State machine: SELECT_PROFILE → SELECT_AXIS → SET_ANGLE
 */
export function useRevolveMode() {
  const {
    elements,
    getObject,
    updateElementBrep,
  } = useCadCore();
  const { camera, renderer, scene, forceSceneUpdate } = useCadVisualizer();
  const { showToast } = useToast();

  const [state, setState] = useState<RevolveState>({
    phase: "SELECT_PROFILE",
    selectedElement: null,
    axisEdgeStart: null,
    axisEdgeEnd: null,
    angle: 360,
    isApplying: false,
    showDimensionInput: false,
    dimensionInputPosition: { x: 0, y: 0 },
  });

  const hoveredElementRef = useRef<string | null>(null);
  const edgeSegmentsRef = useRef<EdgeSegmentData[]>([]);
  const edgeOverlayGroupRef = useRef<THREE.Group | null>(null);
  const hoveredEdgeRef = useRef<number | null>(null);
  const axisLineRef = useRef<THREE.Line | null>(null);

  /**
   * Check if a BRep is flat (2D profile candidate for revolve)
   */
  const isFlatShape = useCallback((brep: Brep): boolean => {
    if (!brep.vertices || brep.vertices.length === 0) return false;
    const xs = brep.vertices.map(v => v.x);
    const ys = brep.vertices.map(v => v.y);
    const zs = brep.vertices.map(v => v.z);
    const rangeX = Math.max(...xs) - Math.min(...xs);
    const rangeY = Math.max(...ys) - Math.min(...ys);
    const rangeZ = Math.max(...zs) - Math.min(...zs);
    return rangeX < 0.01 || rangeY < 0.01 || rangeZ < 0.01;
  }, []);

  /**
   * Reset hover highlight for profile selection
   */
  const resetHover = useCallback(() => {
    if (hoveredElementRef.current) {
      const obj = getObject(hoveredElementRef.current);
      if (obj) {
        obj.traverse(child => {
          if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
            if (hoveredElementRef.current !== state.selectedElement) {
              (child.material as THREE.MeshStandardMaterial).color.set(BODY.default);
            }
          }
        });
      }
      hoveredElementRef.current = null;
    }
  }, [getObject, state.selectedElement]);

  /**
   * Build per-edge overlay lines from element's edge geometry
   */
  const buildEdgeOverlay = useCallback(async (nodeId: string) => {
    const element = elements.find(el => el.nodeId === nodeId);
    if (!element) return;

    const ocService = (await import("../services/OpenCascadeService")).OpenCascadeService.getInstance();

    let edgeDataArr: Array<{ edgeIndex: number; segments: Float32Array; midpoint: { x: number; y: number; z: number } }> | null = null;

    const hasOccBrep = !!element.occBrep;
    const shape = hasOccBrep
      ? await ocService.occBrepToOCShape(element.occBrep, element.position)
      : await ocService.brepToOCShape(element.brep, element.position);
    edgeDataArr = await ocService.getEdgeLineSegmentsPerEdge(shape, 0.05, hasOccBrep, true);

    if (!edgeDataArr || edgeDataArr.length === 0) return;

    edgeSegmentsRef.current = edgeDataArr.map(e => ({
      edgeIndex: e.edgeIndex,
      segments: e.segments,
      midpoint: e.midpoint,
    }));

    // Create overlay group
    const group = new THREE.Group();
    group.userData.isHelper = true;

    for (const edge of edgeSegmentsRef.current) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.Float32BufferAttribute(edge.segments, 3));
      const mat = new THREE.LineBasicMaterial({
        color: REVOLVE.axisLine,
        linewidth: 2,
        depthTest: false,
      });
      const line = new THREE.LineSegments(geom, mat);
      line.renderOrder = 999;
      line.userData.edgeIndex = edge.edgeIndex;
      group.add(line);
    }

    // Add to scene
    const obj = getObject(nodeId);
    if (obj && obj.parent) {
      obj.parent.add(group);
    } else if (scene) {
      scene.add(group);
    }
    edgeOverlayGroupRef.current = group;
    forceSceneUpdate();
  }, [elements, getObject, scene, forceSceneUpdate]);

  /**
   * Remove edge overlay
   */
  const removeEdgeOverlay = useCallback(() => {
    if (edgeOverlayGroupRef.current) {
      edgeOverlayGroupRef.current.parent?.remove(edgeOverlayGroupRef.current);
      edgeOverlayGroupRef.current = null;
    }
    edgeSegmentsRef.current = [];
    hoveredEdgeRef.current = null;
  }, []);

  /**
   * Remove axis visualization line
   */
  const removeAxisLine = useCallback(() => {
    if (axisLineRef.current) {
      axisLineRef.current.parent?.remove(axisLineRef.current);
      axisLineRef.current = null;
    }
  }, []);

  /**
   * Show axis visualization line
   */
  const showAxisLine = useCallback((start: THREE.Vector3, end: THREE.Vector3) => {
    removeAxisLine();
    const dir = end.clone().sub(start).normalize();
    const extendedStart = start.clone().sub(dir.clone().multiplyScalar(5));
    const extendedEnd = end.clone().add(dir.clone().multiplyScalar(5));

    const geom = new THREE.BufferGeometry().setFromPoints([extendedStart, extendedEnd]);
    const mat = new THREE.LineBasicMaterial({
      color: REVOLVE.axisLine,
      linewidth: 2,
      depthTest: false,
    });
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 999;
    line.userData.isHelper = true;
    if (scene) scene.add(line);
    axisLineRef.current = line;
    forceSceneUpdate();
  }, [scene, forceSceneUpdate, removeAxisLine]);

  /**
   * Perform the revolve operation
   */
  const performRevolve = useCallback(async (angleDegrees?: number) => {
    const { selectedElement, axisEdgeStart, axisEdgeEnd } = state;
    if (!selectedElement || !axisEdgeStart || !axisEdgeEnd) return;

    const element = elements.find(el => el.nodeId === selectedElement);
    if (!element) return;

    setState(prev => ({ ...prev, isApplying: true }));

    try {
      const finalAngle = angleDegrees ?? state.angle;
      const angleRadians = (finalAngle / 180) * Math.PI;

      // Compute axis direction from edge endpoints
      const axisDir = {
        x: axisEdgeEnd.x - axisEdgeStart.x,
        y: axisEdgeEnd.y - axisEdgeStart.y,
        z: axisEdgeEnd.z - axisEdgeStart.z,
      };
      const len = Math.sqrt(axisDir.x ** 2 + axisDir.y ** 2 + axisDir.z ** 2);
      if (len < 1e-10) {
        showToast("Invalid axis: edge has zero length", "error");
        setState(prev => ({ ...prev, isApplying: false }));
        return;
      }
      axisDir.x /= len;
      axisDir.y /= len;
      axisDir.z /= len;

      const axisOrigin = {
        x: axisEdgeStart.x,
        y: axisEdgeStart.y,
        z: axisEdgeStart.z,
      };

      const result = await revolveBRep(
        element.brep,
        element.position,
        axisOrigin,
        axisDir,
        Math.abs(finalAngle - 360) < 0.01 ? undefined : angleRadians,
      );

      if (result.brep === element.brep) {
        showToast("Revolve failed", "error");
        setState(prev => ({ ...prev, isApplying: false }));
        return;
      }

      // Compute new position
      const newPosition = new THREE.Vector3(
        element.position.x + result.positionOffset.x,
        element.position.y + result.positionOffset.y,
        element.position.z + result.positionOffset.z,
      );

      // Cleanup before updating
      removeEdgeOverlay();
      removeAxisLine();

      updateElementBrep(
        selectedElement,
        result.brep,
        newPosition,
        { type: "revolve" },
        result.edgeGeometry,
        result.occBrep,
      );

      showToast(`Revolved ${finalAngle}°`, "success");

      // Reset state
      setState({
        phase: "SELECT_PROFILE",
        selectedElement: null,
        axisEdgeStart: null,
        axisEdgeEnd: null,
        angle: 360,
        isApplying: false,
        showDimensionInput: false,
        dimensionInputPosition: { x: 0, y: 0 },
      });
    } catch (error) {
      console.error("[useRevolveMode] Revolve failed:", error);
      showToast("Revolve failed", "error");
      setState(prev => ({ ...prev, isApplying: false }));
    }
  }, [state, elements, updateElementBrep, showToast, removeEdgeOverlay, removeAxisLine]);

  /**
   * Handle mouse down
   */
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!renderer || !camera || event.button !== 0) return;
    if (state.isApplying) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    if (state.phase === "SELECT_PROFILE") {
      // Raycast to find flat profiles
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      const flatElements = elements.filter(el => isFlatShape(el.brep));
      const meshes = collectPickableMeshes(flatElements, (nodeId) => getObject(nodeId));
      const intersects = raycaster.intersectObjects(meshes, false);

      if (intersects.length > 0) {
        let parentObj = intersects[0].object;
        while (parentObj.parent && !parentObj.userData.nodeId) {
          parentObj = parentObj.parent;
        }
        const nodeId = parentObj.userData.nodeId as string;
        if (!nodeId) return;

        // Highlight selected profile
        const obj = getObject(nodeId);
        if (obj) {
          obj.traverse(child => {
            if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
              (child.material as THREE.MeshStandardMaterial).color.set(SELECTION.selected);
            }
          });
        }

        setState(prev => ({
          ...prev,
          phase: "SELECT_AXIS",
          selectedElement: nodeId,
        }));

        // Build edge overlay for axis selection
        buildEdgeOverlay(nodeId);
      }
    } else if (state.phase === "SELECT_AXIS") {
      // Raycast against edge overlay lines
      if (!edgeOverlayGroupRef.current || edgeSegmentsRef.current.length === 0) return;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      raycaster.params.Line = { threshold: 0.15 };

      const intersects = raycaster.intersectObjects(
        edgeOverlayGroupRef.current.children,
        false,
      );

      if (intersects.length > 0) {
        const edgeIndex = intersects[0].object.userData.edgeIndex as number;
        const edgeData = edgeSegmentsRef.current.find(e => e.edgeIndex === edgeIndex);
        if (!edgeData || edgeData.segments.length < 6) return;

        // Use first and last point of edge segments as axis
        const start = new THREE.Vector3(
          edgeData.segments[0],
          edgeData.segments[1],
          edgeData.segments[2],
        );
        const lastIdx = edgeData.segments.length - 3;
        const end = new THREE.Vector3(
          edgeData.segments[lastIdx],
          edgeData.segments[lastIdx + 1],
          edgeData.segments[lastIdx + 2],
        );

        // Remove edge overlay
        removeEdgeOverlay();

        // Show axis line
        showAxisLine(start, end);

        setState(prev => ({
          ...prev,
          phase: "SET_ANGLE",
          axisEdgeStart: start,
          axisEdgeEnd: end,
          showDimensionInput: true,
          dimensionInputPosition: { x: event.clientX, y: event.clientY },
        }));
      }
    }
  }, [
    renderer, camera, state, elements, getObject, isFlatShape,
    buildEdgeOverlay, removeEdgeOverlay, showAxisLine, showToast,
  ]);

  /**
   * Handle mouse move (hover highlighting)
   */
  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!renderer || !camera) return;
    if (state.isApplying) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    if (state.phase === "SELECT_PROFILE") {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      const flatElements = elements.filter(el => isFlatShape(el.brep));
      const meshes = collectPickableMeshes(flatElements, (nodeId) => getObject(nodeId));
      const intersects = raycaster.intersectObjects(meshes, false);

      resetHover();

      if (intersects.length > 0) {
        let parentObj = intersects[0].object;
        while (parentObj.parent && !parentObj.userData.nodeId) {
          parentObj = parentObj.parent;
        }
        const nodeId = parentObj.userData.nodeId as string;
        if (!nodeId) return;

        hoveredElementRef.current = nodeId;
        const obj = getObject(nodeId);
        if (obj) {
          obj.traverse(child => {
            if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
              (child.material as THREE.MeshStandardMaterial).color.set(BODY.hover);
            }
          });
        }
        renderer.domElement.style.cursor = "pointer";
      } else {
        renderer.domElement.style.cursor = "default";
      }
      forceSceneUpdate();
    } else if (state.phase === "SELECT_AXIS") {
      // Hover-highlight edges
      if (!edgeOverlayGroupRef.current) return;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      raycaster.params.Line = { threshold: 0.15 };

      const intersects = raycaster.intersectObjects(
        edgeOverlayGroupRef.current.children,
        false,
      );

      // Reset all to default color
      edgeOverlayGroupRef.current.children.forEach(child => {
        if (child instanceof THREE.LineSegments) {
          (child.material as THREE.LineBasicMaterial).color.set(REVOLVE.axisLine);
        }
      });

      if (intersects.length > 0) {
        const edgeIndex = intersects[0].object.userData.edgeIndex as number;
        hoveredEdgeRef.current = edgeIndex;
        edgeOverlayGroupRef.current.children.forEach(child => {
          if (child instanceof THREE.LineSegments && child.userData.edgeIndex === edgeIndex) {
            (child.material as THREE.LineBasicMaterial).color.set(REVOLVE.axisHover);
          }
        });
        renderer.domElement.style.cursor = "pointer";
      } else {
        hoveredEdgeRef.current = null;
        renderer.domElement.style.cursor = "default";
      }
      forceSceneUpdate();
    }
  }, [renderer, camera, state, elements, getObject, isFlatShape, resetHover, forceSceneUpdate]);

  /**
   * Handle keydown (Enter to confirm, Escape to cancel)
   */
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Enter") {
      if (state.phase === "SET_ANGLE") {
        performRevolve();
      }
    } else if (event.key === "Escape") {
      cleanup();
    }
  }, [state.phase, performRevolve]);

  /**
   * Cleanup all revolve mode state
   */
  const cleanup = useCallback(() => {
    resetHover();
    removeEdgeOverlay();
    removeAxisLine();

    // Reset selected element color
    if (state.selectedElement) {
      const obj = getObject(state.selectedElement);
      if (obj) {
        obj.traverse(child => {
          if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
            (child.material as THREE.MeshStandardMaterial).color.set(BODY.default);
          }
        });
      }
    }

    if (renderer) {
      renderer.domElement.style.cursor = "default";
    }

    setState({
      phase: "SELECT_PROFILE",
      selectedElement: null,
      axisEdgeStart: null,
      axisEdgeEnd: null,
      angle: 360,
      isApplying: false,
      showDimensionInput: false,
      dimensionInputPosition: { x: 0, y: 0 },
    });
    forceSceneUpdate();
  }, [resetHover, removeEdgeOverlay, removeAxisLine, state.selectedElement, getObject, renderer, forceSceneUpdate]);

  return {
    phase: state.phase,
    selectedElement: state.selectedElement,
    isApplying: state.isApplying,
    angle: state.angle,
    showDimensionInput: state.showDimensionInput,
    dimensionInputPosition: state.dimensionInputPosition,
    setAngle: (angle: number) => setState(prev => ({ ...prev, angle })),
    handleMouseDown,
    handleMouseMove,
    handleKeyDown,
    performRevolve,
    cleanup,
  };
}
