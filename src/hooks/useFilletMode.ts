import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { useToast } from "../contexts/ToastContext";
import { Brep } from "../geometry";
import { OpenCascadeService } from "../services/OpenCascadeService";
import { filletBRep, chamferBRep } from "../scene-operations/fillet-operations";
import { isDescendantOf } from "../scene-operations/mesh-operations";
import { isElement3D } from "../scene-operations/types";
import { FILLET, BODY, SELECTION } from "../theme";

export type FilletOperationType = "fillet" | "chamfer";

interface FilletState {
  selectedElement: string | null;
  selectedEdgeIndices: number[];
  hoveredEdgeIndex: number | null;
  radius: number;
  operationType: FilletOperationType;
  isApplying: boolean;
  showDimensionInput: boolean;
  dimensionInputPosition: { x: number; y: number };
}

interface EdgeSegmentData {
  edgeIndex: number;
  segments: Float32Array;
  midpoint: { x: number; y: number; z: number };
}

export function useFilletMode() {
  const { elements, getObject, updateElementBrep } = useCadCore();
  const { camera, renderer, scene, forceSceneUpdate } = useCadVisualizer();
  const { showToast } = useToast();

  const [state, setState] = useState<FilletState>({
    selectedElement: null,
    selectedEdgeIndices: [],
    hoveredEdgeIndex: null,
    radius: 0.3,
    operationType: "fillet",
    isApplying: false,
    showDimensionInput: false,
    dimensionInputPosition: { x: 0, y: 0 },
  });

  // Cached OCC data for selected element
  const edgeSegmentsRef = useRef<EdgeSegmentData[]>([]);
  const edgeOverlayGroupRef = useRef<THREE.Group | null>(null);
  const previewMeshRef = useRef<THREE.Object3D | null>(null);
  const originalMeshRef = useRef<THREE.Object3D | null>(null);
  const originalBrepRef = useRef<Brep | null>(null);
  // Track hovered element for body highlight (before element selection)
  const hoveredBodyRef = useRef<string | null>(null);

  /**
   * Clean up edge overlay lines from scene
   */
  const cleanupEdgeOverlay = useCallback(() => {
    if (scene && edgeOverlayGroupRef.current) {
      scene.remove(edgeOverlayGroupRef.current);
      edgeOverlayGroupRef.current.traverse((child) => {
        if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      edgeOverlayGroupRef.current = null;
    }
    edgeSegmentsRef.current = [];
  }, [scene]);

  /**
   * Clean up preview mesh
   */
  const cleanupPreview = useCallback(() => {
    if (scene && previewMeshRef.current) {
      scene.remove(previewMeshRef.current);
      previewMeshRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
        if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      previewMeshRef.current = null;
    }
  }, [scene]);

  /**
   * Restore original mesh visibility
   */
  const restoreOriginalMesh = useCallback(() => {
    if (originalMeshRef.current) {
      originalMeshRef.current.visible = true;
      originalMeshRef.current = null;
    }
  }, []);

  /**
   * Reset body hover highlight
   */
  const resetBodyHover = useCallback(() => {
    if (hoveredBodyRef.current) {
      const obj = getObject(hoveredBodyRef.current);
      if (obj) {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
            (child.material as THREE.MeshStandardMaterial).color.set(BODY.default);
          }
        });
      }
      hoveredBodyRef.current = null;
    }
  }, [getObject]);

  /**
   * Build edge overlays for the selected element.
   * Creates per-edge LineSegments so we can raycast and highlight individually.
   */
  const buildEdgeOverlays = useCallback(
    async (nodeId: string) => {
      if (!scene) return;
      cleanupEdgeOverlay();

      const element = elements.find((el) => el.nodeId === nodeId);
      if (!element) return;

      try {
        const ocService = OpenCascadeService.getInstance();
        // Build OCC shape at world position+rotation — MUST match the operation path
        // in fillet-operations.ts to guarantee identical edge index ordering
        // (BRepBuilderAPI_Transform with copyGeom=true can reorder edges)
        const hasOccBrep = !!element.occBrep;
        const hasRotation = element.rotation &&
          (element.rotation.x !== 0 || element.rotation.y !== 0 || element.rotation.z !== 0);

        let shape;
        if (hasRotation) {
          // Build at origin, then apply rotation+translation (same as buildWorldShape)
          shape = hasOccBrep
            ? await ocService.occBrepToOCShape(element.occBrep!)
            : await ocService.brepToOCShape(element.brep);
          const oc = await ocService.getOC();
          const threeQuat = new THREE.Quaternion().setFromEuler(element.rotation!);
          const ocQuat = new oc.gp_Quaternion_2(threeQuat.x, threeQuat.y, threeQuat.z, threeQuat.w);
          const vec = new oc.gp_Vec_4(element.position.x, element.position.y, element.position.z);
          const trsf = new oc.gp_Trsf_1();
          trsf.SetRotation_2(ocQuat);
          trsf.SetTranslationPart(vec);
          ocQuat.delete();
          vec.delete();
          const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
          trsf.delete();
          shape = transformer.Shape();
          transformer.delete();
        } else {
          shape = hasOccBrep
            ? await ocService.occBrepToOCShape(element.occBrep!, element.position)
            : await ocService.brepToOCShape(element.brep, element.position);
        }
        // Skip redundant ShapeFix when shape comes from deserialized occBrep
        const edgeData = await ocService.getEdgeLineSegmentsPerEdge(shape, 0.05, hasOccBrep);

        edgeSegmentsRef.current = edgeData;

        const group = new THREE.Group();
        group.userData.isFilletEdgeOverlay = true;
        // Edge coordinates are in world space — no group transform needed

        for (const edge of edgeData) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            "position",
            new THREE.BufferAttribute(edge.segments, 3),
          );

          const material = new THREE.LineBasicMaterial({
            color: FILLET.edgeHover,
            linewidth: 2,
            transparent: true,
            opacity: 0,
            depthTest: false,
          });

          const lineSegments = new THREE.LineSegments(geometry, material);
          lineSegments.userData.edgeIndex = edge.edgeIndex;
          lineSegments.userData.isFilletEdge = true;
          lineSegments.renderOrder = 999;

          group.add(lineSegments);
        }

        scene.add(group);
        edgeOverlayGroupRef.current = group;
        forceSceneUpdate();
      } catch (error) {
        console.error("[useFilletMode] Failed to build edge overlays:", error);
      }
    },
    [elements, scene, forceSceneUpdate, cleanupEdgeOverlay],
  );

  /**
   * Update edge overlay colors based on selection/hover state
   */
  const updateEdgeColors = useCallback(
    (selectedIndices: number[], hoveredIndex: number | null) => {
      if (!edgeOverlayGroupRef.current) return;

      edgeOverlayGroupRef.current.children.forEach((child) => {
        if (child instanceof THREE.LineSegments && child.userData.isFilletEdge) {
          const idx = child.userData.edgeIndex;
          const mat = child.material as THREE.LineBasicMaterial;

          if (selectedIndices.includes(idx)) {
            mat.color.set(FILLET.edgeHighlight);
            mat.opacity = 1.0;
          } else if (idx === hoveredIndex) {
            mat.color.set(FILLET.edgeHover);
            mat.opacity = 1.0;
          } else {
            mat.opacity = 0;
          }
        }
      });
    },
    [],
  );

  /**
   * Show dimension input near the first selected edge's midpoint
   */
  const showDimensionInputAtEdge = useCallback(
    (edgeIndices: number[]) => {
      if (!camera || !renderer || edgeIndices.length === 0) return;

      const firstIdx = edgeIndices[0];
      const edgeData = edgeSegmentsRef.current.find((e) => e.edgeIndex === firstIdx);
      if (!edgeData) return;

      // Edge coordinates are in world space (overlay built at world position+rotation)
      const worldPos = new THREE.Vector3(
        edgeData.midpoint.x,
        edgeData.midpoint.y,
        edgeData.midpoint.z,
      );
      worldPos.project(camera);

      const rect = renderer.domElement.getBoundingClientRect();
      const screenX = ((worldPos.x + 1) / 2) * rect.width + rect.left;
      const screenY = ((-worldPos.y + 1) / 2) * rect.height + rect.top;

      setState((prev) => ({
        ...prev,
        showDimensionInput: true,
        dimensionInputPosition: { x: screenX, y: screenY - 50 },
      }));
    },
    [camera, renderer],
  );

  /**
   * Apply the fillet or chamfer operation
   */
  const applyOperation = useCallback(
    async (radius: number) => {
      if (!state.selectedElement || state.selectedEdgeIndices.length === 0 || radius <= 0) return;

      const element = elements.find((el) => el.nodeId === state.selectedElement);
      if (!element) return;

      setState((prev) => ({ ...prev, isApplying: true }));

      try {
        const operationFn = state.operationType === "fillet" ? filletBRep : chamferBRep;
        const result = await operationFn(
          element.brep,
          element.position,
          state.selectedEdgeIndices,
          radius,
          element.occBrep,
          element.rotation,
        );

        const newPosition = new THREE.Vector3(
          element.position.x + result.positionOffset.x,
          element.position.y + result.positionOffset.y,
          element.position.z + result.positionOffset.z,
        );

        if (updateElementBrep) {
          updateElementBrep(state.selectedElement, result.brep, newPosition, {
            type: state.operationType,
          }, result.edgeGeometry, result.occBrep);
        }

        // Reset state after successful apply
        cleanupEdgeOverlay();
        cleanupPreview();
        restoreOriginalMesh();
        setState({
          selectedElement: null,
          selectedEdgeIndices: [],
          hoveredEdgeIndex: null,
          radius: 0.3,
          operationType: state.operationType, // preserve toggle
          isApplying: false,
          showDimensionInput: false,
          dimensionInputPosition: { x: 0, y: 0 },
        });

        forceSceneUpdate();
      } catch (error) {
        console.error(`[useFilletMode] ${state.operationType} failed:`, error);
        showToast(`${state.operationType === "fillet" ? "Fillet" : "Chamfer"} failed`, "error");
        restoreOriginalMesh();
        setState((prev) => ({ ...prev, isApplying: false }));
      }
    },
    [
      state.selectedElement,
      state.selectedEdgeIndices,
      state.operationType,
      elements,
      updateElementBrep,
      cleanupEdgeOverlay,
      cleanupPreview,
      restoreOriginalMesh,
      forceSceneUpdate,
    ],
  );

  /**
   * Handle mouse down — select element or toggle edge selection
   */
  const handleMouseDown = useCallback(
    (event: MouseEvent) => {
      if (!camera || !renderer || event.button !== 0 || state.isApplying) return;

      const raycaster = new THREE.Raycaster();
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);

      // If element is already selected, check for edge clicks
      if (state.selectedElement && edgeOverlayGroupRef.current) {
        const edgeObjects: THREE.Object3D[] = [];
        edgeOverlayGroupRef.current.traverse((child) => {
          if (child instanceof THREE.LineSegments) {
            edgeObjects.push(child);
          }
        });

        raycaster.params.Line = { threshold: 0.15 };
        const edgeIntersects = raycaster.intersectObjects(edgeObjects);

        if (edgeIntersects.length > 0) {
          const hitEdge = edgeIntersects[0].object;
          const edgeIndex = hitEdge.userData.edgeIndex as number;

          let newSelected: number[];
          if (event.ctrlKey || event.metaKey) {
            // Toggle edge in/out
            if (state.selectedEdgeIndices.includes(edgeIndex)) {
              newSelected = state.selectedEdgeIndices.filter((i) => i !== edgeIndex);
            } else {
              newSelected = [...state.selectedEdgeIndices, edgeIndex];
            }
          } else {
            // Replace selection
            newSelected = [edgeIndex];
          }

          setState((prev) => ({
            ...prev,
            selectedEdgeIndices: newSelected,
            showDimensionInput: newSelected.length > 0,
          }));

          updateEdgeColors(newSelected, null);
          if (newSelected.length > 0) {
            showDimensionInputAtEdge(newSelected);
          }
          forceSceneUpdate();
          event.stopPropagation();
          return;
        }

        // Click on the body itself (but not edge) — keep element selected, deselect edges
        const bodyObjects: THREE.Object3D[] = [];
        const element = elements.find((el) => el.nodeId === state.selectedElement);
        if (element) {
          const obj = getObject(state.selectedElement);
          if (obj) bodyObjects.push(obj);
        }

        const bodyIntersects = raycaster.intersectObjects(bodyObjects, true);
        if (bodyIntersects.length > 0) {
          // Clicked on body but not on an edge — deselect edges
          setState((prev) => ({
            ...prev,
            selectedEdgeIndices: [],
            showDimensionInput: false,
          }));
          event.stopPropagation();
          return;
        }
      }

      // Check for element selection (body click)
      const objects: THREE.Object3D[] = [];
      elements.forEach((el) => {
        if (isElement3D(el)) {
          const obj = getObject(el.nodeId);
          if (obj) objects.push(obj);
        }
      });

      const intersects = raycaster.intersectObjects(objects, true);
      if (intersects.length > 0) {
        const pickedObject = intersects[0].object;

        for (const el of elements) {
          if (!isElement3D(el)) continue;
          const obj = getObject(el.nodeId);
          if (obj && isDescendantOf(pickedObject, obj)) {
            if (el.nodeId !== state.selectedElement) {
              // New element selected
              cleanupEdgeOverlay();
              originalBrepRef.current = el.brep;

              setState((prev) => ({
                ...prev,
                selectedElement: el.nodeId,
                selectedEdgeIndices: [],
                hoveredEdgeIndex: null,
                showDimensionInput: false,
              }));

              // Build edge overlays async
              buildEdgeOverlays(el.nodeId);
            }
            event.stopPropagation();
            return;
          }
        }
      } else {
        // Clicked empty space — deselect everything
        cleanupEdgeOverlay();
        setState((prev) => ({
          ...prev,
          selectedElement: null,
          selectedEdgeIndices: [],
          hoveredEdgeIndex: null,
          showDimensionInput: false,
        }));
      }
    },
    [
      camera,
      renderer,
      state.selectedElement,
      state.selectedEdgeIndices,
      state.isApplying,
      elements,
      getObject,
      cleanupEdgeOverlay,
      buildEdgeOverlays,
      updateEdgeColors,
      showDimensionInputAtEdge,
      forceSceneUpdate,
    ],
  );

  /**
   * Handle mouse move — highlight hovered edges or bodies
   */
  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!camera || !renderer || state.isApplying) return;

      const raycaster = new THREE.Raycaster();
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);

      // If element is selected, check for edge hover
      if (state.selectedElement && edgeOverlayGroupRef.current) {
        const edgeObjects: THREE.Object3D[] = [];
        edgeOverlayGroupRef.current.traverse((child) => {
          if (child instanceof THREE.LineSegments) {
            edgeObjects.push(child);
          }
        });

        raycaster.params.Line = { threshold: 0.15 };
        const edgeIntersects = raycaster.intersectObjects(edgeObjects);

        let newHovered: number | null = null;
        if (edgeIntersects.length > 0) {
          newHovered = edgeIntersects[0].object.userData.edgeIndex as number;
        }

        if (newHovered !== state.hoveredEdgeIndex) {
          setState((prev) => ({ ...prev, hoveredEdgeIndex: newHovered }));
          updateEdgeColors(state.selectedEdgeIndices, newHovered);
          forceSceneUpdate();
        }
        return;
      }

      // No element selected — highlight bodies on hover
      const objects: THREE.Object3D[] = [];
      elements.forEach((el) => {
        if (isElement3D(el)) {
          const obj = getObject(el.nodeId);
          if (obj) objects.push(obj);
        }
      });

      const intersects = raycaster.intersectObjects(objects, true);
      if (intersects.length > 0) {
        const pickedObject = intersects[0].object;
        let foundId: string | null = null;

        for (const el of elements) {
          if (!isElement3D(el)) continue;
          const obj = getObject(el.nodeId);
          if (obj && isDescendantOf(pickedObject, obj)) {
            foundId = el.nodeId;
            break;
          }
        }

        if (foundId && foundId !== hoveredBodyRef.current) {
          resetBodyHover();
          hoveredBodyRef.current = foundId;
          const obj = getObject(foundId);
          if (obj) {
            obj.traverse((child) => {
              if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
                (child.material as THREE.MeshStandardMaterial).color.set(SELECTION.hover);
              }
            });
          }
          forceSceneUpdate();
        } else if (!foundId && hoveredBodyRef.current) {
          resetBodyHover();
          forceSceneUpdate();
        }
      } else if (hoveredBodyRef.current) {
        resetBodyHover();
        forceSceneUpdate();
      }
    },
    [
      camera,
      renderer,
      state.selectedElement,
      state.selectedEdgeIndices,
      state.hoveredEdgeIndex,
      state.isApplying,
      elements,
      getObject,
      updateEdgeColors,
      resetBodyHover,
      forceSceneUpdate,
    ],
  );

  /**
   * Handle mouse up (no-op for now, kept for event listener symmetry)
   */
  const handleMouseUp = useCallback(() => {
    // Dimension input visibility is managed in mouseDown
  }, []);

  /**
   * Handle dimension input submission (radius/distance value)
   */
  const handleRadiusSubmit = useCallback(
    async (value: number) => {
      if (value > 0) {
        setState((prev) => ({ ...prev, radius: value, showDimensionInput: false }));
        await applyOperation(value);
      }
    },
    [applyOperation],
  );

  /**
   * Handle dimension input cancel
   */
  const handleRadiusCancel = useCallback(() => {
    setState((prev) => ({
      ...prev,
      showDimensionInput: false,
    }));
  }, []);

  /**
   * Toggle between fillet and chamfer
   */
  const toggleOperationType = useCallback(() => {
    setState((prev) => ({
      ...prev,
      operationType: prev.operationType === "fillet" ? "chamfer" : "fillet",
    }));
  }, []);

  /**
   * Handle keyboard events
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (state.isApplying) return;

      if (event.key === "Escape") {
        if (state.selectedEdgeIndices.length > 0) {
          // Deselect edges
          setState((prev) => ({
            ...prev,
            selectedEdgeIndices: [],
            hoveredEdgeIndex: null,
            showDimensionInput: false,
          }));
          updateEdgeColors([], null);
          forceSceneUpdate();
        } else if (state.selectedElement) {
          // Deselect element
          cleanupEdgeOverlay();
          setState((prev) => ({
            ...prev,
            selectedElement: null,
            selectedEdgeIndices: [],
            hoveredEdgeIndex: null,
            showDimensionInput: false,
          }));
        }
      } else if (event.key === "Enter") {
        if (state.selectedEdgeIndices.length > 0 && state.radius > 0) {
          applyOperation(state.radius);
        }
      } else if (event.key === "f" || event.key === "F") {
        // Don't toggle if user is typing in an input
        if ((event.target as HTMLElement)?.tagName === "INPUT") return;
        toggleOperationType();
      }
    },
    [
      state.isApplying,
      state.selectedElement,
      state.selectedEdgeIndices,
      state.radius,
      cleanupEdgeOverlay,
      updateEdgeColors,
      applyOperation,
      toggleOperationType,
      forceSceneUpdate,
    ],
  );

  /**
   * Full cleanup when mode changes
   */
  const cleanup = useCallback(() => {
    cleanupEdgeOverlay();
    cleanupPreview();
    restoreOriginalMesh();
    resetBodyHover();
    originalBrepRef.current = null;
    setState({
      selectedElement: null,
      selectedEdgeIndices: [],
      hoveredEdgeIndex: null,
      radius: 0.3,
      operationType: "fillet",
      isApplying: false,
      showDimensionInput: false,
      dimensionInputPosition: { x: 0, y: 0 },
    });
  }, [cleanupEdgeOverlay, cleanupPreview, restoreOriginalMesh, resetBodyHover]);

  // Update dimension input position when edges change
  // This is done inside mousedown to avoid stale closure issues

  // Ensure edge colors stay updated when selectedEdgeIndices changes
  // (handled inline in handleMouseDown — setState + updateEdgeColors in same flow)

  return {
    selectedElement: state.selectedElement,
    selectedEdgeIndices: state.selectedEdgeIndices,
    radius: state.radius,
    operationType: state.operationType,
    isApplying: state.isApplying,
    showDimensionInput: state.showDimensionInput,
    dimensionInputPosition: state.dimensionInputPosition,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleKeyDown,
    handleRadiusSubmit,
    handleRadiusCancel,
    toggleOperationType,
    cleanup,
  };
}
