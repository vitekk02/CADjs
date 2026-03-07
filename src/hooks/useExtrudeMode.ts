import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { useToast } from "../contexts/ToastContext";
import { Brep } from "../geometry";
import { OpenCascadeService } from "../services/OpenCascadeService";
import {
  extrudeBRep,
} from "../scene-operations/resize-operations";
import { isDescendantOf, collectPickableMeshes } from "../scene-operations/mesh-operations";
import { isElement3D, SceneElement } from "../scene-operations/types";
import { EXTRUDE, SKETCH as SKETCH_THEME, BODY, SELECTION } from "../theme";

export type ExtrudeDirection = "up" | "down" | "symmetric";
export type ExtrudeOperationType = "join" | "cut";

interface ExtrudeState {
  selectedElement: string | null;
  isExtruding: boolean;
  activeDirection: ExtrudeDirection | null;
  extrusionDepth: number;
  showDimensionInput: boolean;
  dimensionInputPosition: { x: number; y: number };
  operationType: ExtrudeOperationType;
}

/**
 * Hook for Fusion 360-style extrude mode.
 * Allows selecting flat shapes and extruding them with arrow handles.
 */
export function useExtrudeMode() {
  const { elements, getObject, updateElementBrep } = useCadCore();
  const { camera, renderer, scene, getMouseIntersection, forceSceneUpdate, navToolActiveRef } =
    useCadVisualizer();
  const { showToast } = useToast();

  const [state, setState] = useState<ExtrudeState>({
    selectedElement: null,
    isExtruding: false,
    activeDirection: null,
    extrusionDepth: 0,
    showDimensionInput: false,
    dimensionInputPosition: { x: 0, y: 0 },
    operationType: "join",
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
  // Body dimming state — stores original material properties for restoration
  const dimmedMaterialsRef = useRef<Map<string, { color: number; opacity: number; transparent: boolean }>>(new Map());

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

  /** Dim all 3D bodies so flat profiles stand out (Fusion 360-style) */
  const dimSceneBodies = useCallback(() => {
    dimmedMaterialsRef.current.clear();
    elements.forEach((el) => {
      if (!isElement3D(el)) return; // Only dim 3D bodies, leave flat profiles visible
      const obj = getObject(el.nodeId);
      if (!obj) return;
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && !child.userData.isEdgeOverlay && !child.userData.isHelper) {
          const mat = child.material as THREE.MeshStandardMaterial;
          dimmedMaterialsRef.current.set(child.uuid, {
            color: mat.color.getHex(),
            opacity: mat.opacity,
            transparent: mat.transparent,
          });
          mat.transparent = true;
          mat.opacity = BODY.dimmedOpacity;
          mat.color.set(BODY.dimmedColor);
          mat.needsUpdate = true;
        }
        if (child.userData.isEdgeOverlay) {
          const mat = (child as any).material;
          if (mat) {
            dimmedMaterialsRef.current.set(child.uuid, {
              color: mat.color.getHex(),
              opacity: mat.opacity ?? 1,
              transparent: mat.transparent ?? false,
            });
            mat.transparent = true;
            mat.opacity = BODY.dimmedOpacity;
            mat.needsUpdate = true;
          }
        }
      });
    });
  }, [elements, getObject]);

  /** Restore all dimmed bodies to their original appearance */
  const restoreSceneBodies = useCallback(() => {
    if (dimmedMaterialsRef.current.size === 0) return;
    // Traverse the whole scene — avoids stale closure over elements/getObject
    scene?.traverse((child) => {
      const saved = dimmedMaterialsRef.current.get(child.uuid);
      if (!saved) return;
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.color.set(saved.color);
        mat.opacity = saved.opacity;
        mat.transparent = saved.transparent;
        mat.needsUpdate = true;
      }
      if (child.userData.isEdgeOverlay) {
        const mat = (child as any).material;
        if (mat) {
          mat.color.set(saved.color);
          mat.opacity = saved.opacity;
          mat.transparent = saved.transparent;
          mat.needsUpdate = true;
        }
      }
    });
    dimmedMaterialsRef.current.clear();
  }, [scene]);

  /**
   * Get the normal direction of a flat BRep (the axis it's flat along).
   * If element has a sketchPlane, uses that normal directly.
   * Otherwise falls back to detecting the flat axis from vertex ranges.
   */
  const getFlatNormal = useCallback((brep: Brep, element?: SceneElement): THREE.Vector3 => {
    // Use sketch plane normal when available (e.g., face sketches, offset planes)
    if (element?.sketchPlane) {
      return element.sketchPlane.normal.clone();
    }

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
   * Create arrow handles for extrusion.
   * @param nodeId - The element to create handles for
   * @param opType - Optional operation type override (avoids stale state during toggle)
   */
  const createArrowHandles = useCallback(
    (nodeId: string, opType?: ExtrudeOperationType) => {
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
      const normal = getFlatNormal(element.brep, element);

      // Choose colors based on operation type
      const effectiveOpType = opType ?? state.operationType;
      const isCut = effectiveOpType === "cut";
      const primaryColor = isCut ? EXTRUDE.cutArrow : EXTRUDE.arrow;
      const secondaryColor = isCut ? EXTRUDE.cutArrowSecondary : EXTRUDE.arrowSecondary;
      // In cut mode, swap opacity so "into body" (down/negative normal) is full opacity
      const upOpacity = isCut ? 0.5 : 1.0;
      const downOpacity = isCut ? 1.0 : 0.5;

      // Create up arrow (positive normal direction)
      const upArrow = createArrow(
        center,
        normal.clone(),
        arrowLength,
        shaftRadius,
        headRadius,
        headLength,
        primaryColor,
        upOpacity,
        "up"
      );
      scene.add(upArrow);
      arrowHandlesRef.current.push(upArrow);

      // Create down arrow (negative normal direction)
      const downArrow = createArrow(
        center,
        normal.clone().negate(),
        arrowLength,
        shaftRadius,
        headRadius,
        headLength,
        secondaryColor,
        downOpacity,
        "down"
      );
      scene.add(downArrow);
      arrowHandlesRef.current.push(downArrow);

      forceSceneUpdate();
    },
    [elements, getObject, scene, forceSceneUpdate, cleanupHandles, createArrow, getFlatNormal, state.operationType]
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
    async (brep: Brep, element?: SceneElement): Promise<THREE.BufferGeometry | null> => {
      try {
        const ocService = OpenCascadeService.getInstance();
        let cleanFace = null;
        if (element?.occBrep) {
          try {
            cleanFace = await ocService.deserializeShape(element.occBrep);
          } catch { /* fall through */ }
        }
        if (!cleanFace) {
          cleanFace = await ocService.buildPlanarFaceFromBoundary(brep);
        }
        if (!cleanFace) return null;

        // Extrude by unit depth=1 along the flat normal
        const normal = getFlatNormal(brep, element);
        const normalVec = { x: normal.x, y: normal.y, z: normal.z };
        const extrudedShape = await ocService.extrudeShape(cleanFace, 1, 1, normalVec);

        // Convert to Three.js geometry with coarse tessellation for speed
        const geometry = await ocService.shapeToThreeGeometry(extrudedShape, 0.003, 0.1);
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
        const previewColor = state.operationType === "cut" ? EXTRUDE.cutPreview : EXTRUDE.profileHighlight;

        const previewMesh = new THREE.Mesh(
          cachedPreviewGeometryRef.current,
          new THREE.MeshStandardMaterial({
            color: previewColor,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
            depthTest: false,
          })
        );
        previewMesh.renderOrder = 500;

        // The cached geometry is a unit extrusion (depth=1) along the flat normal
        // Scale the appropriate axis to match the desired depth
        const normal = getFlatNormal(originalBrepRef.current, element);
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
      state.operationType,
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

        // Pass sketch plane normal to extrudeBRep for non-axis-aligned profiles
        const normal = getFlatNormal(originalBrepRef.current, element);
        const normalVec = { x: normal.x, y: normal.y, z: normal.z };

        // Extrude the BRep - returns { brep, positionOffset }
        const extrusionResult = await extrudeBRep(
          originalBrepRef.current,
          depth,
          ocDirection,
          normalVec,
          element.occBrep,
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
          updateElementBrep(state.selectedElement, extrusionResult.brep, newPosition, { type: "extrude" }, extrusionResult.edgeGeometry, extrusionResult.occBrep, extrusionResult.faceGeometry, extrusionResult.vertexPositions);
        }

        forceSceneUpdate();
      } catch (error) {
        console.error("Extrusion failed:", error);
        showToast("Extrusion failed", "error");
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
      getFlatNormal,
    ]
  );

  /**
   * Toggle between Join and Cut extrude operation types
   */
  const toggleOperationType = useCallback(() => {
    setState((prev) => {
      const newType = prev.operationType === "join" ? "cut" : "join";
      // Recreate arrows with updated colors if an element is selected
      if (prev.selectedElement) {
        // Use setTimeout to ensure state is updated before recreating arrows
        setTimeout(() => createArrowHandles(prev.selectedElement!, newType), 0);
      }
      return { ...prev, operationType: newType };
    });
  }, [createArrowHandles]);

  /**
   * Apply cut extrusion: extrude tool shape, then boolean-subtract from intersecting body
   */
  const applyCutExtrusion = useCallback(
    async (depth: number, direction: ExtrudeDirection) => {
      if (!state.selectedElement || !originalBrepRef.current) return;

      const profileElement = elements.find((el) => el.nodeId === state.selectedElement);
      if (!profileElement) return;

      try {
        const ocService = OpenCascadeService.getInstance();

        // 1. Extrude the profile to create the tool solid
        let ocDirection: number;
        switch (direction) {
          case "down": ocDirection = -1; break;
          default: ocDirection = 1;
        }

        // Pass sketch plane normal to extrudeBRep for non-axis-aligned profiles
        const normal = getFlatNormal(originalBrepRef.current, profileElement);
        const normalVec = { x: normal.x, y: normal.y, z: normal.z };

        const extrusionResult = await extrudeBRep(originalBrepRef.current, depth, ocDirection, normalVec);

        // 2. Calculate world position of the extruded tool
        const toolWorldPos = new THREE.Vector3(
          profileElement.position.x + extrusionResult.positionOffset.x,
          profileElement.position.y + extrusionResult.positionOffset.y,
          profileElement.position.z + extrusionResult.positionOffset.z
        );

        // Convert tool BRep to OCC shape at world position
        const toolShape = await ocService.brepToOCShape(extrusionResult.brep, toolWorldPos);

        // 3. Find an intersecting 3D body
        let targetElement: SceneElement | null = null;
        let targetShape = null;

        // 3a: Prefer sourceElementId from sketch plane (sketch was created on this body)
        const sourceId = profileElement.sketchPlane?.sourceElementId;
        if (sourceId) {
          const sourceEl = elements.find((el) => el.nodeId === sourceId);
          if (sourceEl && isElement3D(sourceEl)) {
            targetElement = sourceEl;
            targetShape = sourceEl.occBrep
              ? await ocService.occBrepToOCShape(sourceEl.occBrep, sourceEl.position)
              : await ocService.brepToOCShape(sourceEl.brep, sourceEl.position);
          }
        }

        // 3b: Fallback — bounding box overlap check using tool BRep vertices (not mesh, which may be hidden)
        if (!targetElement) {
          // Compute tool bounding box from extrusionResult.brep vertices + toolWorldPos
          const toolBox = new THREE.Box3();
          for (const v of extrusionResult.brep.vertices) {
            toolBox.expandByPoint(new THREE.Vector3(
              v.x + toolWorldPos.x,
              v.y + toolWorldPos.y,
              v.z + toolWorldPos.z,
            ));
          }
          // Expand tool box in extrusion direction to ensure overlap
          const expandVec = normal.clone().multiplyScalar(depth * 2);
          toolBox.expandByVector(new THREE.Vector3(Math.abs(expandVec.x), Math.abs(expandVec.y), Math.abs(expandVec.z)));

          for (const el of elements) {
            if (el.nodeId === state.selectedElement) continue;
            if (!isElement3D(el)) continue;

            const targetObj = getObject(el.nodeId);
            if (targetObj) {
              const targetBox = new THREE.Box3().setFromObject(targetObj);
              if (toolBox.intersectsBox(targetBox)) {
                targetElement = el;
                targetShape = el.occBrep
                  ? await ocService.occBrepToOCShape(el.occBrep, el.position)
                  : await ocService.brepToOCShape(el.brep, el.position);
                break;
              }
            }
          }
        }

        if (!targetElement || !targetShape) {
          showToast("No intersecting body found for cut", "error");
          restoreOriginalMesh();
          return;
        }

        // 4. Boolean difference: target - tool
        const diffResult = await ocService.booleanDifference(targetShape, toolShape);
        const resultShape = diffResult.shape;

        // 5. Convert result
        const resultBrep = await ocService.ocShapeToBRep(resultShape, true);

        // 6. Calculate world center from uncentered result (result shape is in world space)
        const uncenteredBrep = await ocService.ocShapeToBRep(resultShape, false);
        const uverts = uncenteredBrep.vertices;
        const uxs = uverts.map(v => v.x);
        const uys = uverts.map(v => v.y);
        const uzs = uverts.map(v => v.z);
        const worldCenter = new THREE.Vector3(
          (Math.min(...uxs) + Math.max(...uxs)) / 2,
          (Math.min(...uys) + Math.max(...uys)) / 2,
          (Math.min(...uzs) + Math.max(...uzs)) / 2,
        );

        // 7. Extract edge geometry and face geometry for clean rendering (translated to local space)
        const edgeGeometry = await ocService.shapeToEdgeLineSegments(resultShape, 0.003);
        edgeGeometry.translate(-worldCenter.x, -worldCenter.y, -worldCenter.z);
        const vertexPositions = await ocService.shapeToVertexPositions(resultShape);
        for (let i = 0; i < vertexPositions.length; i += 3) {
          vertexPositions[i] -= worldCenter.x;
          vertexPositions[i + 1] -= worldCenter.y;
          vertexPositions[i + 2] -= worldCenter.z;
        }

        const faceGeometry = await ocService.shapeToThreeGeometry(resultShape, 0.003, 0.1);
        faceGeometry.translate(-worldCenter.x, -worldCenter.y, -worldCenter.z);

        // 8. Serialize in local space for occBrep preservation
        const oc = await ocService.getOC();
        const trsf = new oc.gp_Trsf_1();
        const vec = new oc.gp_Vec_4(-worldCenter.x, -worldCenter.y, -worldCenter.z);
        trsf.SetTranslation_1(vec);
        vec.delete();
        const transformer = new oc.BRepBuilderAPI_Transform_2(resultShape, trsf, true);
        trsf.delete();
        const localShape = transformer.Shape();
        transformer.delete();
        const occBrep = await ocService.serializeShape(localShape);

        // 9. Update the target element with the cut result
        // The consumedElementId tells CoreContext to also remove the profile element
        updateElementBrep(
          targetElement.nodeId,
          resultBrep,
          worldCenter,
          { type: "difference", consumedElementId: state.selectedElement },
          edgeGeometry,
          occBrep,
          faceGeometry,
          vertexPositions,
        );

        forceSceneUpdate();
      } catch (error) {
        console.error("Cut extrusion failed:", error);
        showToast("Cut extrusion failed", "error");
        restoreOriginalMesh();
      }

      originalBrepRef.current = null;
      cachedPreviewGeometryRef.current = null;
    },
    [
      state.selectedElement,
      elements,
      getObject,
      updateElementBrep,
      forceSceneUpdate,
      restoreOriginalMesh,
      showToast,
      getFlatNormal,
    ]
  );

  /**
   * Handle mouse down - select element or start dragging handle
   */
  const handleMouseDown = useCallback(
    (event: MouseEvent) => {
      if (!camera || !renderer || event.button !== 0 || event.altKey || navToolActiveRef.current) return;

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

        startPointRef.current = getMouseIntersection(event);
        startScreenRef.current = { x: event.clientX, y: event.clientY };

        // Store original BRep and build preview geometry via OCC
        const element = elements.find(
          (el) => el.nodeId === state.selectedElement
        );

        // Calculate screen position for dimension input immediately
        let screenPos = { x: 0, y: 0 };
        if (element && camera && renderer) {
          const center = element.position.clone();
          center.project(camera);
          const rect = renderer.domElement.getBoundingClientRect();
          screenPos = {
            x: ((center.x + 1) / 2) * rect.width + rect.left,
            y: ((-center.y + 1) / 2) * rect.height + rect.top - 50,
          };
        }

        setState((prev) => ({
          ...prev,
          isExtruding: true,
          activeDirection: activeDir,
          extrusionDepth: 1.0,
          showDimensionInput: true,
          dimensionInputPosition: screenPos,
        }));

        if (element) {
          originalBrepRef.current = element.brep;

          // Build the OCC preview geometry and show default preview at depth 1.0
          cachedPreviewGeometryRef.current = null;
          buildCachedPreviewGeometry(element.brep, element).then((geometry) => {
            cachedPreviewGeometryRef.current = geometry;
            // Show preview at default depth once geometry is ready
            updatePreview(1.0, activeDir);
          });
        }

        event.stopPropagation();
        return;
      }

      // Only pick flat profiles — 3D bodies are dimmed and non-interactive
      const flatElements = elements.filter(el => isFlatShape(el.brep));
      const meshes = collectPickableMeshes(flatElements, getObject);
      const intersects = raycaster.intersectObjects(meshes, false);
      if (intersects.length > 0) {
        const pickedObject = intersects[0].object;

        for (const el of flatElements) {
          const obj = getObject(el.nodeId);
          if (obj && isDescendantOf(pickedObject, obj)) {
            setState((prev) => ({
              ...prev,
              selectedElement: el.nodeId,
              showDimensionInput: false,
            }));
            createArrowHandles(el.nodeId);
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

        // Only hover-highlight flat profiles — 3D bodies are dimmed and non-interactive
        const flatElements = elements.filter(el => isFlatShape(el.brep));
        const meshes = collectPickableMeshes(flatElements, getObject);
        const intersects = raycaster.intersectObjects(meshes, false);
        if (intersects.length > 0) {
          const pickedObject = intersects[0].object;
          let foundId: string | null = null;

          for (const el of flatElements) {
            const obj = getObject(el.nodeId);
            if (obj && isDescendantOf(pickedObject, obj)) {
              foundId = el.nodeId;
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
      const normal = selectedEl ? getFlatNormal(selectedEl.brep, selectedEl) : new THREE.Vector3(0, 0, 1);

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
   * Handle mouse up - transition to confirm state (keep preview visible)
   */
  const handleMouseUp = useCallback(() => {
    if (!state.isExtruding || !state.selectedElement) {
      return;
    }

    // Stop dragging but keep dimension input and preview visible
    setState((prev) => ({
      ...prev,
      isExtruding: false,
    }));

    startPointRef.current = null;
    startScreenRef.current = null;
  }, [
    state.isExtruding,
    state.selectedElement,
  ]);

  /**
   * Handle dimension input submission — applies the extrusion
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

        // Clean up preview before applying (apply creates new mesh)
        cleanupPreview();
        restoreOriginalMesh();

        if (state.operationType === "cut") {
          await applyCutExtrusion(value, state.activeDirection || "up");
        } else {
          await applyExtrusion(value, state.activeDirection || "up");
        }
      }

      setState((prev) => ({
        ...prev,
        showDimensionInput: false,
        activeDirection: null,
        extrusionDepth: 0,
        selectedElement: null,
      }));

      cleanupHandles();
    },
    [
      state.selectedElement,
      state.activeDirection,
      state.operationType,
      elements,
      applyExtrusion,
      applyCutExtrusion,
      cleanupHandles,
      cleanupPreview,
      restoreOriginalMesh,
    ]
  );

  /**
   * Handle live dimension value change — updates preview in real-time
   */
  const handleDimensionChange = useCallback(
    (value: number) => {
      if (!state.selectedElement || !state.activeDirection) return;
      setState((prev) => ({ ...prev, extrusionDepth: value }));
      updatePreview(value, state.activeDirection);
    },
    [state.selectedElement, state.activeDirection, updatePreview]
  );

  /**
   * Handle dimension input cancel — restores original state
   */
  const handleDimensionCancel = useCallback(() => {
    cleanupPreview();
    restoreOriginalMesh();

    setState((prev) => ({
      ...prev,
      showDimensionInput: false,
      isExtruding: false,
      activeDirection: null,
      extrusionDepth: 0,
    }));

    originalBrepRef.current = null;
    cachedPreviewGeometryRef.current = null;
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
    restoreSceneBodies();
    setState((prev) => ({
      selectedElement: null,
      isExtruding: false,
      activeDirection: null,
      extrusionDepth: 0,
      showDimensionInput: false,
      dimensionInputPosition: { x: 0, y: 0 },
      operationType: prev.operationType, // preserve toggle across cleanup
    }));
    startPointRef.current = null;
    startScreenRef.current = null;
    originalBrepRef.current = null;
  }, [cleanupHandles, cleanupPreview, cleanupHoverOverlay, restoreOriginalMesh, restoreSceneBodies]);

  return {
    selectedElement: state.selectedElement,
    isExtruding: state.isExtruding,
    extrusionDepth: state.extrusionDepth,
    activeDirection: state.activeDirection,
    showDimensionInput: state.showDimensionInput,
    dimensionInputPosition: state.dimensionInputPosition,
    operationType: state.operationType,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleKeyDown,
    handleDimensionSubmit,
    handleDimensionCancel,
    handleDimensionChange,
    toggleOperationType,
    cleanup,
    dimSceneBodies,
  };
}
