import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { Brep } from "../geometry";
import { OpenCascadeService } from "../services/OpenCascadeService";
import {
  extrudeBRep,
} from "../scene-operations/resize-operations";
import { isDescendantOf, collectPickableMeshes } from "../scene-operations/mesh-operations";
import { EXTRUDE, SKETCH as SKETCH_THEME, BODY, SELECTION } from "../theme";

export type ExtrudeDirection = "up" | "down" | "symmetric";

interface ExtrudeState {
  selectedElement: string | null;
  isExtruding: boolean;
  activeDirection: ExtrudeDirection | null;
  extrusionDepth: number;
  showDimensionInput: boolean;
  dimensionInputPosition: { x: number; y: number };
}

/**
 * Hook for Fusion 360-style extrude mode.
 * Allows selecting flat shapes and extruding them with arrow handles.
 */
export function useExtrudeMode() {
  const { elements, getObject, updateElementBrep } = useCadCore();
  const { camera, renderer, scene, getMouseIntersection, forceSceneUpdate } =
    useCadVisualizer();

  const [state, setState] = useState<ExtrudeState>({
    selectedElement: null,
    isExtruding: false,
    activeDirection: null,
    extrusionDepth: 0,
    showDimensionInput: false,
    dimensionInputPosition: { x: 0, y: 0 },
  });

  const startPointRef = useRef<THREE.Vector3 | null>(null);
  const startScreenRef = useRef<{ x: number; y: number } | null>(null);
  const originalBrepRef = useRef<Brep | null>(null);
  const arrowHandlesRef = useRef<THREE.Object3D[]>([]);
  const previewMeshRef = useRef<THREE.Mesh | null>(null);
  const originalMeshRef = useRef<THREE.Object3D | null>(null);
  // Cached unit extrusion geometry (built once via OCC when drag starts)
  const cachedPreviewGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  // Profile hover highlight
  const hoveredElementRef = useRef<string | null>(null);
  const hoverOverlayRef = useRef<THREE.Mesh | null>(null);

  /**
   * Check if a BRep is flat (2D shape — flat along any single axis)
   */
  const isFlatShape = useCallback((brep: Brep): boolean => {
    if (!brep.vertices || brep.vertices.length === 0) return false;

    const xs = brep.vertices.map((v) => v.x);
    const ys = brep.vertices.map((v) => v.y);
    const zs = brep.vertices.map((v) => v.z);

    const rangeX = Math.max(...xs) - Math.min(...xs);
    const rangeY = Math.max(...ys) - Math.min(...ys);
    const rangeZ = Math.max(...zs) - Math.min(...zs);

    return rangeX < 0.01 || rangeY < 0.01 || rangeZ < 0.01;
  }, []);

  /**
   * Get the normal direction of a flat BRep (the axis it's flat along).
   * Returns (0,0,1) for XY-plane shapes, (0,1,0) for XZ, (1,0,0) for YZ.
   */
  const getFlatNormal = useCallback((brep: Brep): THREE.Vector3 => {
    if (!brep.vertices || brep.vertices.length === 0)
      return new THREE.Vector3(0, 0, 1);

    const xs = brep.vertices.map((v) => v.x);
    const ys = brep.vertices.map((v) => v.y);
    const zs = brep.vertices.map((v) => v.z);

    const rangeX = Math.max(...xs) - Math.min(...xs);
    const rangeY = Math.max(...ys) - Math.min(...ys);
    const rangeZ = Math.max(...zs) - Math.min(...zs);

    if (rangeX < 0.01) return new THREE.Vector3(1, 0, 0);
    if (rangeY < 0.01) return new THREE.Vector3(0, 1, 0);
    return new THREE.Vector3(0, 0, 1);
  }, []);

  /**
   * Create a single arrow (shaft + cone head)
   */
  const createArrow = useCallback(
    (
      origin: THREE.Vector3,
      direction: THREE.Vector3,
      length: number,
      shaftRadius: number,
      headRadius: number,
      headLength: number,
      color: number,
      opacity: number,
      handleDirection: "up" | "down"
    ): THREE.Group => {
      const group = new THREE.Group();
      group.userData.handleType = "extrudeArrow";
      group.userData.direction = handleDirection;

      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
      });

      // Shaft (cylinder)
      const shaftLength = length - headLength;
      const shaftGeometry = new THREE.CylinderGeometry(
        shaftRadius,
        shaftRadius,
        shaftLength,
        16
      );
      const shaft = new THREE.Mesh(shaftGeometry, material);
      shaft.userData.handleType = "extrudeArrow";
      shaft.userData.direction = handleDirection;

      // Position shaft centered along the direction
      shaft.position.copy(direction.clone().multiplyScalar(shaftLength / 2));

      // Rotate to align with direction (cylinder is Y-up by default)
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.clone().normalize()
      );
      shaft.quaternion.copy(quaternion);

      group.add(shaft);

      // Head (cone)
      const headGeometry = new THREE.ConeGeometry(headRadius, headLength, 16);
      const head = new THREE.Mesh(headGeometry, material);
      head.userData.handleType = "extrudeArrow";
      head.userData.direction = handleDirection;

      // Position head at the end of shaft
      head.position.copy(
        direction.clone().multiplyScalar(shaftLength + headLength / 2)
      );
      head.quaternion.copy(quaternion);

      group.add(head);

      // Position the entire group at the origin point
      group.position.copy(origin);

      return group;
    },
    []
  );

  /**
   * Clean up arrow handles from scene
   */
  const cleanupHandles = useCallback(() => {
    if (scene) {
      arrowHandlesRef.current.forEach((handle) => {
        scene.remove(handle);
        handle.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      });
      arrowHandlesRef.current = [];
    }
  }, [scene]);

  /**
   * Create arrow handles for extrusion
   */
  const createArrowHandles = useCallback(
    (nodeId: string) => {
      if (!scene) return;
      cleanupHandles();

      const element = elements.find((el) => el.nodeId === nodeId);
      if (!element) return;

      const obj = getObject(nodeId);
      if (!obj) return;

      // Get bounding box center
      const bbox = new THREE.Box3().setFromObject(obj);
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      // Arrow parameters
      const arrowLength = 1.5;
      const shaftRadius = 0.04;
      const headRadius = 0.12;
      const headLength = 0.3;

      // Determine the extrusion direction based on which axis the shape is flat along
      const normal = getFlatNormal(element.brep);

      // Create up arrow (primary - full opacity)
      const upArrow = createArrow(
        center,
        normal.clone(),
        arrowLength,
        shaftRadius,
        headRadius,
        headLength,
        EXTRUDE.arrow,
        1.0,
        "up"
      );
      scene.add(upArrow);
      arrowHandlesRef.current.push(upArrow);

      // Create down arrow (secondary - half opacity)
      const downArrow = createArrow(
        center,
        normal.clone().negate(),
        arrowLength,
        shaftRadius,
        headRadius,
        headLength,
        EXTRUDE.arrowSecondary,
        0.5,
        "down"
      );
      scene.add(downArrow);
      arrowHandlesRef.current.push(downArrow);

      forceSceneUpdate();
    },
    [elements, getObject, scene, forceSceneUpdate, cleanupHandles, createArrow, getFlatNormal]
  );

  /**
   * Clean up preview mesh
   */
  const cleanupPreview = useCallback(() => {
    if (scene && previewMeshRef.current) {
      scene.remove(previewMeshRef.current);
      previewMeshRef.current.geometry.dispose();
      if (Array.isArray(previewMeshRef.current.material)) {
        previewMeshRef.current.material.forEach((m) => m.dispose());
      } else {
        (previewMeshRef.current.material as THREE.Material).dispose();
      }
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
   * Build OCC-based unit extrusion geometry (called once when drag starts).
   * Creates a correctly shaped extrusion of depth=1 that can be Z-scaled during drag.
   */
  const buildCachedPreviewGeometry = useCallback(
    async (brep: Brep): Promise<THREE.BufferGeometry | null> => {
      try {
        const ocService = OpenCascadeService.getInstance();
        const cleanFace = await ocService.buildPlanarFaceFromBoundary(brep);
        if (!cleanFace) return null;

        // Extrude by unit depth=1 along the flat normal
        const normal = getFlatNormal(brep);
        const normalVec = { x: normal.x, y: normal.y, z: normal.z };
        const extrudedShape = await ocService.extrudeShape(cleanFace, 1, 1, normalVec);

        // Convert to Three.js geometry with coarse tessellation for speed
        const geometry = await ocService.shapeToThreeGeometry(extrudedShape, 0.1, 0.5);
        return geometry;
      } catch (error) {
        console.warn("[useExtrudeMode] Failed to build OCC preview geometry:", error);
        return null;
      }
    },
    [getFlatNormal]
  );

  /**
   * Update preview mesh during drag.
   * Uses cached OCC geometry (correct shape with holes/concavities) scaled in Z.
   */
  const updatePreview = useCallback(
    (depth: number, direction: ExtrudeDirection) => {
      console.log("[updatePreview] called", { depth, direction, selectedElement: state.selectedElement, hasOriginalBrep: !!originalBrepRef.current });
      if (!state.selectedElement || !originalBrepRef.current) return;

      const element = elements.find((el) => el.nodeId === state.selectedElement);
      if (!element) { console.log("[updatePreview] element not found"); return; }

      const obj = getObject(state.selectedElement);
      if (!obj) { console.log("[updatePreview] obj not found"); return; }

      // Hide original mesh during preview
      if (!originalMeshRef.current) {
        originalMeshRef.current = obj;
        obj.visible = false;
      }

      // Clean up previous preview
      cleanupPreview();

      const extrusionDepth = Math.abs(depth);
      console.log("[updatePreview] cachedPreviewGeometry:", !!cachedPreviewGeometryRef.current, "extrusionDepth:", extrusionDepth);

      // Use cached OCC geometry if available (correct shape with holes)
      if (cachedPreviewGeometryRef.current) {
        const directionSign = direction === "down" ? -1 : 1;

        const previewMesh = new THREE.Mesh(
          cachedPreviewGeometryRef.current,
          new THREE.MeshStandardMaterial({
            color: EXTRUDE.profileHighlight,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
          })
        );

        // The cached geometry is a unit extrusion (depth=1) along the flat normal
        // Scale the appropriate axis to match the desired depth
        const normal = getFlatNormal(originalBrepRef.current);
        const s = extrusionDepth * directionSign;
        previewMesh.scale.set(
          normal.x ? s : 1,
          normal.y ? s : 1,
          normal.z ? s : 1,
        );
        previewMesh.position.copy(element.position);
        previewMesh.userData.isPreview = true;

        if (scene) {
          scene.add(previewMesh);
          previewMeshRef.current = previewMesh;
          forceSceneUpdate();
        }
      }
      // If cached geometry not yet built, skip preview frame (will be available next frame)
    },
    [
      state.selectedElement,
      elements,
      getObject,
      scene,
      cleanupPreview,
      forceSceneUpdate,
    ]
  );

  /**
   * Apply extrusion to the selected element
   */
  const applyExtrusion = useCallback(
    async (depth: number, direction: ExtrudeDirection) => {
      if (!state.selectedElement || !originalBrepRef.current) return;

      const element = elements.find((el) => el.nodeId === state.selectedElement);
      if (!element) return;

      try {
        // Determine OpenCascade direction
        let ocDirection: number;
        switch (direction) {
          case "up":
            ocDirection = 1;
            break;
          case "down":
            ocDirection = -1;
            break;
          case "symmetric":
            // For symmetric, extrude in positive direction
            ocDirection = 1;
            break;
          default:
            ocDirection = 1;
        }

        // Extrude the BRep - returns { brep, positionOffset }
        const extrusionResult = await extrudeBRep(
          originalBrepRef.current,
          depth,
          ocDirection
        );

        // Calculate the new position:
        // Both input and output BReps are centered at origin
        // Only apply the Z offset from extrusion; X/Y position stays the same
        const newPosition = new THREE.Vector3(
          element.position.x + extrusionResult.positionOffset.x,
          element.position.y + extrusionResult.positionOffset.y,
          element.position.z + extrusionResult.positionOffset.z
        );

        // Update the element's BRep and position
        if (updateElementBrep) {
          updateElementBrep(state.selectedElement, extrusionResult.brep, newPosition, { type: "extrude" }, extrusionResult.edgeGeometry);
        }

        forceSceneUpdate();
      } catch (error) {
        console.error("Extrusion failed:", error);
        // Restore original on failure
        restoreOriginalMesh();
      }

      originalBrepRef.current = null;
      cachedPreviewGeometryRef.current = null;
    },
    [
      state.selectedElement,
      elements,
      updateElementBrep,
      forceSceneUpdate,
      restoreOriginalMesh,
    ]
  );

  /**
   * Handle mouse down - select element or start dragging handle
   */
  const handleMouseDown = useCallback(
    (event: MouseEvent) => {
      if (!camera || !renderer || event.button !== 0) return;

      const raycaster = new THREE.Raycaster();
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);

      // Check if clicking on arrow handles
      const handleObjects: THREE.Object3D[] = [];
      arrowHandlesRef.current.forEach((handle) => {
        handle.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            handleObjects.push(child);
          }
        });
      });

      const handleIntersects = raycaster.intersectObjects(handleObjects);
      console.log("[handleMouseDown] handleObjects:", handleObjects.length, "handleIntersects:", handleIntersects.length);
      if (handleIntersects.length > 0) {
        const handle = handleIntersects[0].object;
        const direction = handle.userData.direction as "up" | "down";

        // Check for Shift key for symmetric mode
        const activeDir: ExtrudeDirection = event.shiftKey
          ? "symmetric"
          : direction;

        setState((prev) => ({
          ...prev,
          isExtruding: true,
          activeDirection: activeDir,
          extrusionDepth: 0,
        }));

        startPointRef.current = getMouseIntersection(event);
        startScreenRef.current = { x: event.clientX, y: event.clientY };

        // Store original BRep and build preview geometry via OCC
        const element = elements.find(
          (el) => el.nodeId === state.selectedElement
        );
        if (element) {
          originalBrepRef.current = element.brep;

          // Start building the OCC preview geometry (async, will be ready for next mouse move)
          cachedPreviewGeometryRef.current = null;
          buildCachedPreviewGeometry(element.brep).then((geometry) => {
            cachedPreviewGeometryRef.current = geometry;
          });
        }

        event.stopPropagation();
        return;
      }

      // Check if clicking on scene elements (mesh-only, skip edge overlays)
      const meshes = collectPickableMeshes(elements, getObject);
      const intersects = raycaster.intersectObjects(meshes, false);
      if (intersects.length > 0) {
        const pickedObject = intersects[0].object;

        for (const el of elements) {
          const obj = getObject(el.nodeId);
          if (obj && isDescendantOf(pickedObject, obj)) {
            // Check if it's a flat shape
            if (isFlatShape(el.brep)) {
              setState((prev) => ({
                ...prev,
                selectedElement: el.nodeId,
                showDimensionInput: false,
              }));
              createArrowHandles(el.nodeId);
            } else {
              // Not a flat shape - deselect
              setState((prev) => ({
                ...prev,
                selectedElement: null,
                showDimensionInput: false,
              }));
              cleanupHandles();
            }
            event.stopPropagation();
            return;
          }
        }
      } else {
        // Clicked on empty space - deselect
        setState((prev) => ({
          ...prev,
          selectedElement: null,
          showDimensionInput: false,
        }));
        cleanupHandles();
      }
    },
    [
      camera,
      renderer,
      elements,
      state.selectedElement,
      getObject,
      getMouseIntersection,
      isFlatShape,
      createArrowHandles,
      cleanupHandles,
    ]
  );

  /**
   * Handle mouse move - update preview during drag
   */
  // Cleanup hover overlay
  const cleanupHoverOverlay = useCallback(() => {
    if (scene && hoverOverlayRef.current) {
      scene.remove(hoverOverlayRef.current);
      hoverOverlayRef.current.geometry.dispose();
      (hoverOverlayRef.current.material as THREE.Material).dispose();
      hoverOverlayRef.current = null;
    }
    // Reset previously hovered element color
    if (hoveredElementRef.current) {
      const obj = getObject(hoveredElementRef.current);
      if (obj) {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay) {
            (child.material as THREE.MeshStandardMaterial).color.set(BODY.default);
          }
        });
      }
      hoveredElementRef.current = null;
    }
  }, [scene, getObject]);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      // Profile hover highlighting when not extruding
      if (
        !state.isExtruding &&
        !state.selectedElement &&
        camera &&
        renderer
      ) {
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
              if (isFlatShape(el.brep)) {
                foundId = el.nodeId;
              }
              break;
            }
          }

          if (foundId && foundId !== hoveredElementRef.current) {
            cleanupHoverOverlay();
            hoveredElementRef.current = foundId;
            // Tint the element with a blue highlight
            const obj = getObject(foundId);
            if (obj) {
              obj.traverse((child) => {
                if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay) {
                  (child.material as THREE.MeshStandardMaterial).color.set(SELECTION.hover);
                }
              });
            }
          } else if (!foundId && hoveredElementRef.current) {
            cleanupHoverOverlay();
          }
        } else if (hoveredElementRef.current) {
          cleanupHoverOverlay();
        }
        return;
      }

      if (
        !state.isExtruding ||
        !startPointRef.current ||
        !state.activeDirection
      ) {
        return;
      }
      console.log("[handleMouseMove] extruding, dir:", state.activeDirection);

      event.preventDefault();
      event.stopPropagation();

      if (!camera || !renderer || !startScreenRef.current) return;

      // Determine the extrusion normal from the selected element's BRep
      const selectedEl = elements.find((el) => el.nodeId === state.selectedElement);
      const normal = selectedEl ? getFlatNormal(selectedEl.brep) : new THREE.Vector3(0, 0, 1);

      // Project extrusion normal to screen space to determine how mouse pixel movement maps to depth.
      // getMouseIntersection returns points on the ground plane (Z=0), so for XY-plane shapes
      // (normal=Z), worldDelta.z is always 0. Instead, use screen-space projection.
      const element = selectedEl;
      if (!element) return;
      const origin = element.position.clone();
      const normalEnd = origin.clone().add(normal);

      // Project both points to screen pixels
      const rect = renderer.domElement.getBoundingClientRect();
      const originNDC = origin.clone().project(camera);
      const normalEndNDC = normalEnd.clone().project(camera);
      const screenDir = new THREE.Vector2(
        (normalEndNDC.x - originNDC.x) * rect.width / 2,
        -(normalEndNDC.y - originNDC.y) * rect.height / 2,
      );
      const screenDirLen = screenDir.length();

      // Mouse pixel delta from drag start
      const mouseDeltaPx = new THREE.Vector2(
        event.clientX - startScreenRef.current.x,
        event.clientY - startScreenRef.current.y,
      );

      let projectedDelta: number;
      if (screenDirLen < 1) {
        // Normal points straight at camera — use vertical screen movement as depth
        // Negative because screen Y increases downward but "up" extrusion should be positive
        projectedDelta = -mouseDeltaPx.y * 0.02;
      } else {
        // Project mouse pixel delta onto the screen-space direction of the normal
        // Result: how many "units" the mouse moved along the extrusion direction
        const screenDirNorm = screenDir.clone().normalize();
        const pixelDist = mouseDeltaPx.dot(screenDirNorm);
        projectedDelta = pixelDist / screenDirLen;
      }
      let extrusionDepth: number;

      if (state.activeDirection === "up") {
        extrusionDepth = Math.max(0.01, projectedDelta);
      } else if (state.activeDirection === "down") {
        extrusionDepth = Math.max(0.01, -projectedDelta);
      } else {
        // Symmetric - use absolute value
        extrusionDepth = Math.max(0.01, Math.abs(projectedDelta));
      }

      // Snap to grid if not holding a modifier key
      if (!event.ctrlKey) {
        extrusionDepth = Math.round(extrusionDepth * 4) / 4; // 0.25 unit snap
      }

      setState((prev) => ({
        ...prev,
        extrusionDepth,
      }));

      updatePreview(extrusionDepth, state.activeDirection);
    },
    [state.isExtruding, state.selectedElement, state.activeDirection, camera, renderer, elements, getObject, getMouseIntersection, updatePreview, cleanupHoverOverlay, getFlatNormal]
  );

  /**
   * Handle mouse up - apply extrusion or show dimension input
   */
  const handleMouseUp = useCallback(async () => {
    if (!state.isExtruding || !state.selectedElement) {
      return;
    }

    // If depth is very small, show dimension input for manual entry
    if (state.extrusionDepth < 0.1) {
      // Calculate position for dimension input
      const obj = getObject(state.selectedElement);
      if (obj && camera && renderer) {
        const bbox = new THREE.Box3().setFromObject(obj);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        center.project(camera);

        const rect = renderer.domElement.getBoundingClientRect();
        const screenX = ((center.x + 1) / 2) * rect.width + rect.left;
        const screenY = ((-center.y + 1) / 2) * rect.height + rect.top;

        setState((prev) => ({
          ...prev,
          isExtruding: false,
          showDimensionInput: true,
          dimensionInputPosition: { x: screenX, y: screenY - 50 },
        }));

        // Clean up preview but keep selection
        cleanupPreview();
        restoreOriginalMesh();
      }
      return;
    }

    // Apply the extrusion
    await applyExtrusion(state.extrusionDepth, state.activeDirection!);

    // Reset state
    setState((prev) => ({
      ...prev,
      isExtruding: false,
      activeDirection: null,
      extrusionDepth: 0,
      selectedElement: null,
    }));

    startPointRef.current = null;
    startScreenRef.current = null;
    cleanupPreview();
    restoreOriginalMesh();

    // Clean up handles (shape is now 3D)
    cleanupHandles();
  }, [
    state.isExtruding,
    state.selectedElement,
    state.extrusionDepth,
    state.activeDirection,
    getObject,
    camera,
    renderer,
    applyExtrusion,
    cleanupPreview,
    restoreOriginalMesh,
    cleanupHandles,
  ]);

  /**
   * Handle dimension input submission
   */
  const handleDimensionSubmit = useCallback(
    async (value: number) => {
      if (value > 0 && state.selectedElement) {
        // Store original BRep if not already stored
        if (!originalBrepRef.current) {
          const element = elements.find(
            (el) => el.nodeId === state.selectedElement
          );
          if (element) {
            originalBrepRef.current = element.brep;
          }
        }
        await applyExtrusion(value, state.activeDirection || "up");
      }

      setState((prev) => ({
        ...prev,
        showDimensionInput: false,
        activeDirection: null,
        selectedElement: null,
      }));

      cleanupHandles();
    },
    [
      state.selectedElement,
      state.activeDirection,
      elements,
      applyExtrusion,
      cleanupHandles,
    ]
  );

  /**
   * Handle dimension input cancel
   */
  const handleDimensionCancel = useCallback(() => {
    setState((prev) => ({
      ...prev,
      showDimensionInput: false,
      isExtruding: false,
      activeDirection: null,
      extrusionDepth: 0,
    }));

    cleanupPreview();
    restoreOriginalMesh();
  }, [cleanupPreview, restoreOriginalMesh]);

  /**
   * Handle keyboard events
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Cancel current operation
        setState((prev) => ({
          ...prev,
          isExtruding: false,
          showDimensionInput: false,
          activeDirection: null,
          extrusionDepth: 0,
        }));
        cleanupPreview();
        restoreOriginalMesh();
      }
    },
    [cleanupPreview, restoreOriginalMesh]
  );

  /**
   * Full cleanup when mode changes
   */
  const cleanup = useCallback(() => {
    cleanupHandles();
    cleanupPreview();
    cleanupHoverOverlay();
    restoreOriginalMesh();
    setState({
      selectedElement: null,
      isExtruding: false,
      activeDirection: null,
      extrusionDepth: 0,
      showDimensionInput: false,
      dimensionInputPosition: { x: 0, y: 0 },
    });
    startPointRef.current = null;
    startScreenRef.current = null;
    originalBrepRef.current = null;
  }, [cleanupHandles, cleanupPreview, cleanupHoverOverlay, restoreOriginalMesh]);

  return {
    selectedElement: state.selectedElement,
    isExtruding: state.isExtruding,
    extrusionDepth: state.extrusionDepth,
    activeDirection: state.activeDirection,
    showDimensionInput: state.showDimensionInput,
    dimensionInputPosition: state.dimensionInputPosition,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleKeyDown,
    handleDimensionSubmit,
    handleDimensionCancel,
    cleanup,
  };
}
