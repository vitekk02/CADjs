import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { useToast } from "../contexts/ToastContext";
import { Brep } from "../geometry";
import { sweepBRep } from "../scene-operations/sweep-operations";
import { isDescendantOf, collectPickableMeshes } from "../scene-operations/mesh-operations";
import { SWEEP, BODY, SELECTION } from "../theme";

export type SweepPhase = "SELECT_PROFILE" | "SELECT_PATH" | "READY";

interface SweepState {
  phase: SweepPhase;
  selectedProfile: string | null;
  selectedPath: string | null;
  isApplying: boolean;
}

/**
 * Hook for Fusion 360-style sweep mode.
 * State machine: SELECT_PROFILE → SELECT_PATH → READY (confirm to apply)
 */
export function useSweepMode() {
  const {
    elements,
    getObject,
    removeElement,
    updateElementBrep,
    selectElement,
    deselectAll,
  } = useCadCore();
  const { camera, renderer, scene, forceSceneUpdate } = useCadVisualizer();
  const { showToast } = useToast();

  const [state, setState] = useState<SweepState>({
    phase: "SELECT_PROFILE",
    selectedProfile: null,
    selectedPath: null,
    isApplying: false,
  });

  const hoveredElementRef = useRef<string | null>(null);
  const previewMeshRef = useRef<THREE.Object3D | null>(null);

  /**
   * Check if a BRep is flat (2D profile candidate for sweep)
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
   * Reset hover highlight
   */
  const resetHover = useCallback(() => {
    if (hoveredElementRef.current) {
      const obj = getObject(hoveredElementRef.current);
      if (obj) {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
            (child.material as THREE.MeshStandardMaterial).color.set(BODY.default);
          }
        });
      }
      hoveredElementRef.current = null;
    }
  }, [getObject]);

  /**
   * Highlight selected profile/path
   */
  const highlightSelected = useCallback((nodeId: string, color: number) => {
    const obj = getObject(nodeId);
    if (obj) {
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
          (child.material as THREE.MeshStandardMaterial).color.set(color);
        }
        if (child instanceof THREE.Line && child.userData.isPathLine) {
          (child.material as THREE.LineBasicMaterial).color.set(color);
        }
      });
    }
  }, [getObject]);

  /**
   * Clean up preview
   */
  const cleanupPreview = useCallback(() => {
    if (scene && previewMeshRef.current) {
      scene.remove(previewMeshRef.current);
      previewMeshRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      previewMeshRef.current = null;
    }
  }, [scene]);

  /**
   * Handle mouse down — select profile or path based on current phase
   */
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!camera || !renderer || event.button !== 0 || state.isApplying) return;

    const raycaster = new THREE.Raycaster();
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);

    const meshes = collectPickableMeshes(elements, getObject);
    // Also include path lines in raycasting
    const allObjects: THREE.Object3D[] = [...meshes];
    elements.forEach(el => {
      if (el.elementType === "path") {
        const obj = getObject(el.nodeId);
        if (obj) {
          obj.traverse(child => {
            if (child instanceof THREE.Line) {
              allObjects.push(child);
            }
          });
        }
      }
    });

    const intersects = raycaster.intersectObjects(allObjects, false);
    if (intersects.length === 0) return;

    const pickedObject = intersects[0].object;

    for (const el of elements) {
      const obj = getObject(el.nodeId);
      if (!obj || !isDescendantOf(pickedObject, obj)) continue;

      if (state.phase === "SELECT_PROFILE") {
        // Only flat shapes (with faces) can be profiles
        if (el.elementType === "path") continue;
        if (!isFlatShape(el.brep)) continue;

        resetHover();
        highlightSelected(el.nodeId, SELECTION.selected);

        setState(prev => ({
          ...prev,
          phase: "SELECT_PATH",
          selectedProfile: el.nodeId,
        }));
        event.stopPropagation();
        return;
      }

      if (state.phase === "SELECT_PATH") {
        // Only path elements can be selected as paths
        if (el.elementType !== "path" || !el.pathData) continue;

        resetHover();
        highlightSelected(el.nodeId, SELECTION.selected);

        setState(prev => ({
          ...prev,
          phase: "READY",
          selectedPath: el.nodeId,
        }));
        event.stopPropagation();
        return;
      }

      break;
    }
  }, [camera, renderer, elements, getObject, state.phase, state.isApplying, isFlatShape, resetHover, highlightSelected]);

  /**
   * Handle mouse move — hover highlighting
   */
  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!camera || !renderer || state.isApplying) return;
    if (state.phase === "READY") return;

    const raycaster = new THREE.Raycaster();
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);

    const allObjects: THREE.Object3D[] = [];
    elements.forEach(el => {
      const obj = getObject(el.nodeId);
      if (!obj) return;
      obj.traverse(child => {
        if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
          allObjects.push(child);
        }
        if (child instanceof THREE.Line && child.userData.isPathLine) {
          allObjects.push(child);
        }
      });
    });

    const intersects = raycaster.intersectObjects(allObjects, false);
    if (intersects.length > 0) {
      const pickedObject = intersects[0].object;
      let foundId: string | null = null;

      for (const el of elements) {
        const obj = getObject(el.nodeId);
        if (obj && isDescendantOf(pickedObject, obj)) {
          // Filter based on phase
          if (state.phase === "SELECT_PROFILE" && el.elementType !== "path" && isFlatShape(el.brep)) {
            foundId = el.nodeId;
          } else if (state.phase === "SELECT_PATH" && el.elementType === "path") {
            foundId = el.nodeId;
          }
          break;
        }
      }

      if (foundId && foundId !== hoveredElementRef.current &&
          foundId !== state.selectedProfile && foundId !== state.selectedPath) {
        resetHover();
        hoveredElementRef.current = foundId;
        highlightSelected(foundId, SELECTION.hover);
        forceSceneUpdate();
      } else if (!foundId && hoveredElementRef.current) {
        resetHover();
        forceSceneUpdate();
      }
    } else if (hoveredElementRef.current) {
      resetHover();
      forceSceneUpdate();
    }
  }, [camera, renderer, elements, getObject, state.phase, state.selectedProfile, state.selectedPath, state.isApplying, isFlatShape, resetHover, highlightSelected, forceSceneUpdate]);

  /**
   * Perform the sweep operation
   */
  const performSweep = useCallback(async () => {
    if (!state.selectedProfile || !state.selectedPath) return;

    const profileEl = elements.find(el => el.nodeId === state.selectedProfile);
    const pathEl = elements.find(el => el.nodeId === state.selectedPath);
    if (!profileEl || !pathEl || !pathEl.pathData) return;

    setState(prev => ({ ...prev, isApplying: true }));

    try {
      console.log("[useSweepMode] profileEl.position:", profileEl.position);
      console.log("[useSweepMode] pathEl.pathData.points:", pathEl.pathData.points);

      const result = await sweepBRep(
        profileEl.brep,
        profileEl.position,
        pathEl.pathData.points
      );

      if (result.brep.faces.length > 0) {
        // Update the profile element with the swept solid
        // Add relative positionOffset to element position (matching extrude pattern)
        const newPosition = new THREE.Vector3(
          profileEl.position.x + result.positionOffset.x,
          profileEl.position.y + result.positionOffset.y,
          profileEl.position.z + result.positionOffset.z,
        );

        console.log("[useSweepMode] result.positionOffset:", result.positionOffset);
        console.log("[useSweepMode] newPosition:", newPosition);

        if (updateElementBrep) {
          updateElementBrep(
            state.selectedProfile,
            result.brep,
            newPosition,
            { type: "sweep", consumedElementId: state.selectedPath },
            result.edgeGeometry,
            result.occBrep
          );
        }

        // Remove the path element
        removeElement(state.selectedPath);

        forceSceneUpdate();
      } else {
        console.error("[useSweepMode] Sweep produced empty result");
        showToast("Sweep produced empty result", "error");
      }
    } catch (error) {
      console.error("[useSweepMode] Sweep failed:", error);
      showToast("Sweep failed", "error");
    }

    setState({
      phase: "SELECT_PROFILE",
      selectedProfile: null,
      selectedPath: null,
      isApplying: false,
    });
  }, [state.selectedProfile, state.selectedPath, elements, updateElementBrep, removeElement, forceSceneUpdate]);

  const canSweep = state.phase === "READY" && !!state.selectedProfile && !!state.selectedPath;

  /**
   * Handle keyboard events
   */
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (state.phase === "READY" || state.phase === "SELECT_PATH") {
        // Go back to profile selection
        if (state.selectedProfile) {
          highlightSelected(state.selectedProfile, BODY.default);
        }
        if (state.selectedPath) {
          // Reset path to default path color
          const pathEl = elements.find(el => el.nodeId === state.selectedPath);
          if (pathEl) {
            const obj = getObject(state.selectedPath);
            if (obj) {
              obj.traverse(child => {
                if (child instanceof THREE.Line && child.userData.isPathLine) {
                  (child.material as THREE.LineBasicMaterial).color.set(SWEEP.pathPreview);
                }
              });
            }
          }
        }
        cleanupPreview();
        setState({
          phase: "SELECT_PROFILE",
          selectedProfile: null,
          selectedPath: null,
          isApplying: false,
        });
      }
    } else if (event.key === "Enter" && canSweep) {
      performSweep();
    }
  }, [state.phase, state.selectedProfile, state.selectedPath, elements, getObject, canSweep, highlightSelected, cleanupPreview, performSweep]);

  /**
   * Full cleanup when mode changes
   */
  const cleanup = useCallback(() => {
    resetHover();
    cleanupPreview();

    // Reset any selected element colors
    if (state.selectedProfile) {
      highlightSelected(state.selectedProfile, BODY.default);
    }
    if (state.selectedPath) {
      const obj = getObject(state.selectedPath);
      if (obj) {
        obj.traverse(child => {
          if (child instanceof THREE.Line && child.userData.isPathLine) {
            (child.material as THREE.LineBasicMaterial).color.set(SWEEP.pathPreview);
          }
        });
      }
    }

    setState({
      phase: "SELECT_PROFILE",
      selectedProfile: null,
      selectedPath: null,
      isApplying: false,
    });
  }, [resetHover, cleanupPreview, state.selectedProfile, state.selectedPath, getObject, highlightSelected]);

  return {
    phase: state.phase,
    selectedProfile: state.selectedProfile,
    selectedPath: state.selectedPath,
    isApplying: state.isApplying,
    handleMouseDown,
    handleMouseMove,
    handleKeyDown,
    performSweep,
    canSweep,
    cleanup,
  };
}
