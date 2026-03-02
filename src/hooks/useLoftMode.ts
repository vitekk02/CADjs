import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { useToast } from "../contexts/ToastContext";
import { Brep } from "../geometry";
import { loftBReps } from "../scene-operations/loft-operations";
import { isDescendantOf, collectPickableMeshes } from "../scene-operations/mesh-operations";
import { LOFT, BODY, SELECTION } from "../theme";

interface LoftState {
  selectedProfiles: string[];
  isApplying: boolean;
}

/**
 * Hook for Fusion 360-style loft mode.
 * Select 2+ flat profiles in order → creates smooth blended solid.
 */
export function useLoftMode() {
  const {
    elements,
    getObject,
    loftElements,
  } = useCadCore();
  const { camera, renderer, scene, forceSceneUpdate, navToolActiveRef } = useCadVisualizer();
  const { showToast } = useToast();

  const [state, setState] = useState<LoftState>({
    selectedProfiles: [],
    isApplying: false,
  });

  const hoveredElementRef = useRef<string | null>(null);

  /**
   * Check if a BRep is flat (2D profile candidate for loft)
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
        obj.traverse(child => {
          if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
            // Check if this element is in selectedProfiles — keep selection color
            if (!state.selectedProfiles.includes(hoveredElementRef.current!)) {
              (child.material as THREE.MeshStandardMaterial).color.set(BODY.default);
            }
          }
        });
      }
      hoveredElementRef.current = null;
    }
  }, [getObject, state.selectedProfiles]);

  /**
   * Handle mouse down — toggle profile selection
   */
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!camera || !renderer || event.button !== 0 || event.altKey || navToolActiveRef.current || state.isApplying) return;

    const raycaster = new THREE.Raycaster();
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);

    const meshes = collectPickableMeshes(elements, getObject);
    const intersects = raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
      const pickedObject = intersects[0].object;

      for (const el of elements) {
        const obj = getObject(el.nodeId);
        if (obj && isDescendantOf(pickedObject, obj)) {
          // Only flat shapes, not paths
          if (el.elementType === "path") break;
          if (!isFlatShape(el.brep)) break;

          // Toggle selection
          if (state.selectedProfiles.includes(el.nodeId)) {
            // Deselect
            obj.traverse(child => {
              if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
                (child.material as THREE.MeshStandardMaterial).color.set(BODY.default);
              }
            });
            setState(prev => ({
              ...prev,
              selectedProfiles: prev.selectedProfiles.filter(id => id !== el.nodeId),
            }));
          } else {
            // Select
            obj.traverse(child => {
              if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
                (child.material as THREE.MeshStandardMaterial).color.set(SELECTION.selected);
              }
            });
            setState(prev => ({
              ...prev,
              selectedProfiles: [...prev.selectedProfiles, el.nodeId],
            }));
          }
          event.stopPropagation();
          break;
        }
      }
    }
  }, [camera, renderer, elements, getObject, state.selectedProfiles, state.isApplying, isFlatShape]);

  /**
   * Handle mouse move — hover highlighting
   */
  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!camera || !renderer || state.isApplying) return;

    const raycaster = new THREE.Raycaster();
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);

    const meshes = collectPickableMeshes(elements, getObject);
    const intersects = raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
      const pickedObject = intersects[0].object;
      let foundId: string | null = null;

      for (const el of elements) {
        const obj = getObject(el.nodeId);
        if (obj && isDescendantOf(pickedObject, obj)) {
          if (el.elementType !== "path" && isFlatShape(el.brep)) {
            foundId = el.nodeId;
          }
          break;
        }
      }

      if (foundId && foundId !== hoveredElementRef.current &&
          !state.selectedProfiles.includes(foundId)) {
        resetHover();
        hoveredElementRef.current = foundId;
        const obj = getObject(foundId);
        if (obj) {
          obj.traverse(child => {
            if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
              (child.material as THREE.MeshStandardMaterial).color.set(SELECTION.hover);
            }
          });
        }
        forceSceneUpdate();
      } else if (!foundId && hoveredElementRef.current) {
        resetHover();
        forceSceneUpdate();
      }
    } else if (hoveredElementRef.current) {
      resetHover();
      forceSceneUpdate();
    }
  }, [camera, renderer, elements, getObject, state.selectedProfiles, state.isApplying, isFlatShape, resetHover, forceSceneUpdate]);

  /**
   * Perform the loft operation
   */
  const performLoft = useCallback(async () => {
    if (state.selectedProfiles.length < 2) return;

    setState(prev => ({ ...prev, isApplying: true }));

    try {
      // Collect profile data in selection order
      const profiles = state.selectedProfiles.map(nodeId => {
        const el = elements.find(e => e.nodeId === nodeId);
        return el ? { brep: el.brep, position: el.position } : null;
      }).filter((p): p is { brep: Brep; position: THREE.Vector3 } => p !== null);

      if (profiles.length < 2) {
        console.error("[useLoftMode] Not enough valid profiles");
        showToast("Not enough valid profiles for loft", "error");
        setState(prev => ({ ...prev, isApplying: false }));
        return;
      }

      const result = await loftBReps(profiles);

      if (result && result.brep.faces.length > 0) {
        loftElements(state.selectedProfiles, result.brep, result.position, result.edgeGeometry, result.occBrep);
        forceSceneUpdate();
      } else {
        console.error("[useLoftMode] Loft produced empty result");
        showToast("Loft produced empty result", "error");
      }
    } catch (error) {
      console.error("[useLoftMode] Loft failed:", error);
      showToast("Loft failed", "error");
    }

    setState({
      selectedProfiles: [],
      isApplying: false,
    });
  }, [state.selectedProfiles, elements, loftElements, forceSceneUpdate]);

  const canLoft = state.selectedProfiles.length >= 2;

  /**
   * Handle keyboard events
   */
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      // Reset all selections
      for (const nodeId of state.selectedProfiles) {
        const obj = getObject(nodeId);
        if (obj) {
          obj.traverse(child => {
            if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
              (child.material as THREE.MeshStandardMaterial).color.set(BODY.default);
            }
          });
        }
      }
      setState({
        selectedProfiles: [],
        isApplying: false,
      });
    } else if (event.key === "Enter" && canLoft) {
      performLoft();
    }
  }, [state.selectedProfiles, getObject, canLoft, performLoft]);

  /**
   * Full cleanup when mode changes
   */
  const cleanup = useCallback(() => {
    resetHover();
    for (const nodeId of state.selectedProfiles) {
      const obj = getObject(nodeId);
      if (obj) {
        obj.traverse(child => {
          if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
            (child.material as THREE.MeshStandardMaterial).color.set(BODY.default);
          }
        });
      }
    }
    setState({
      selectedProfiles: [],
      isApplying: false,
    });
  }, [resetHover, state.selectedProfiles, getObject]);

  return {
    selectedProfiles: state.selectedProfiles,
    isApplying: state.isApplying,
    handleMouseDown,
    handleMouseMove,
    handleKeyDown,
    performLoft,
    canLoft,
    cleanup,
  };
}
