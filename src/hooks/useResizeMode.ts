import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { Brep } from "../geometry";
import {
  extrudeBRep,
  extrudeThreeJsObject,
} from "../scene-operations/resize-operations";
import { isDescendantOf, collectPickableMeshes } from "../scene-operations/mesh-operations";
import { RESIZE } from "../theme";

/**
 * Detect which axis a BRep is flat along (range < threshold).
 * Returns "x", "y", or "z". Defaults to "z" if none or multiple are flat.
 */
function getFlatAxis(brep: Brep): "x" | "y" | "z" {
  if (!brep.vertices || brep.vertices.length === 0) return "z";
  const xs = brep.vertices.map((v) => v.x);
  const ys = brep.vertices.map((v) => v.y);
  const zs = brep.vertices.map((v) => v.z);
  const rangeX = Math.max(...xs) - Math.min(...xs);
  const rangeY = Math.max(...ys) - Math.min(...ys);
  const rangeZ = Math.max(...zs) - Math.min(...zs);
  if (rangeX < 0.01) return "x";
  if (rangeY < 0.01) return "y";
  return "z";
}

export function useResizeMode() {
  const { elements, getObject, updateElementPosition, objectsMap } =
    useCadCore();
  const { camera, renderer, scene, getMouseIntersection, forceSceneUpdate } =
    useCadVisualizer();

  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [activeHandleDirection, setActiveHandleDirection] = useState<
    number | null
  >(null);
  const startPointRef = useRef<THREE.Vector3 | null>(null);
  const originalBrepRef = useRef<Brep | null>(null);
  const resizeHandlesRef = useRef<THREE.Object3D[]>([]);

  const createResizeHandles = useCallback(
    (nodeId: string) => {
      if (!scene) return;
      cleanupHandles();

      const element = elements.find((el) => el.nodeId === nodeId);
      if (!element) return;

      const obj = getObject(nodeId);
      if (!obj) return;

      const bbox = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      const handleSize = 0.2;
      const handleGeometry = new THREE.BoxGeometry(
        handleSize,
        handleSize,
        handleSize
      );
      const handleMaterial = new THREE.MeshBasicMaterial({ color: RESIZE.handle });

      const handlePositions = [
        {
          position: new THREE.Vector3(bbox.max.x, center.y, center.z),
          axis: "x",
          dir: 1,
        },
        {
          position: new THREE.Vector3(bbox.min.x, center.y, center.z),
          axis: "x",
          dir: -1,
        },
        {
          position: new THREE.Vector3(center.x, bbox.max.y, center.z),
          axis: "y",
          dir: 1,
        },
        {
          position: new THREE.Vector3(center.x, bbox.min.y, center.z),
          axis: "y",
          dir: -1,
        },
        {
          position: new THREE.Vector3(center.x, center.y, bbox.max.z),
          axis: "z",
          dir: 1,
        },
        {
          position: new THREE.Vector3(center.x, center.y, bbox.min.z),
          axis: "z",
          dir: -1,
        },
      ];

      handlePositions.forEach(({ position, axis, dir }) => {
        const handle = new THREE.Mesh(handleGeometry, handleMaterial);
        handle.position.copy(position);
        handle.userData.handleType = "resize";
        handle.userData.axis = axis;
        handle.userData.direction = dir;
        handle.userData.nodeId = nodeId;
        scene.add(handle);
        resizeHandlesRef.current.push(handle);
      });

      originalBrepRef.current = element.brep;

      forceSceneUpdate();
    },
    [elements, getObject, scene]
  );

  useEffect(() => {
    if (selectedElement) {
      createResizeHandles(selectedElement);
    }
  }, [selectedElement, createResizeHandles]);

  const cleanupHandles = useCallback(() => {
    if (scene) {
      resizeHandlesRef.current.forEach((handle) => {
        scene.remove(handle);
      });
      resizeHandlesRef.current = [];
    }
  }, [scene]);

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

      const handleIntersects = raycaster.intersectObjects(
        resizeHandlesRef.current
      );
      if (handleIntersects.length > 0) {
        const handle = handleIntersects[0].object;
        setActiveHandle(handle.userData.axis);
        setActiveHandleDirection(handle.userData.direction);
        setIsResizing(true);
        startPointRef.current = getMouseIntersection(event);
        return;
      }

      const meshes = collectPickableMeshes(elements, getObject);
      const intersects = raycaster.intersectObjects(meshes, false);
      if (intersects.length > 0) {
        const pickedObject = intersects[0].object;

        for (const el of elements) {
          const obj = getObject(el.nodeId);
          if (obj && isDescendantOf(pickedObject, obj)) {
            if (selectedElement !== el.nodeId) {
              setSelectedElement(el.nodeId);
            }
            event.stopPropagation(); // Prevent event bubbling
            break;
          }
        }
      } else {
        setSelectedElement(null);
        cleanupHandles();
      }
    },
    [
      camera,
      renderer,
      elements,
      selectedElement, // Add this dependency
      getObject,
      cleanupHandles,
      getMouseIntersection,
    ]
  );

  const extrusionParamsRef = useRef<{
    depth: number;
    direction: number;
  } | null>(null);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (
        !isResizing ||
        !activeHandle ||
        !startPointRef.current ||
        !selectedElement
      )
        return;

      event.preventDefault();
      event.stopPropagation();

      const currentPoint = getMouseIntersection(event);
      if (!currentPoint) return;

      const element = elements.find((el) => el.nodeId === selectedElement);
      if (!element || !originalBrepRef.current) return;

      let objRef = getObject(selectedElement);
      if (!objRef) return;

      const delta = new THREE.Vector3().subVectors(
        currentPoint,
        startPointRef.current
      );

      const activeHandleObj = resizeHandlesRef.current.find(
        (handle) =>
          handle.userData.axis === activeHandle &&
          handle.userData.direction === activeHandleDirection &&
          handle.userData.nodeId === selectedElement
      );

      if (!activeHandleObj) return;

      const direction = activeHandleObj.userData.direction;

      if (!objRef.userData.originalBoxMin || !objRef.userData.originalBoxMax) {
        const bbox = new THREE.Box3().setFromObject(objRef);
        objRef.userData.originalBoxMin = bbox.min.clone();
        objRef.userData.originalBoxMax = bbox.max.clone();
        objRef.userData.originalPosition = objRef.position.clone();
        objRef.userData.originalScale = objRef.scale.clone();
      }

      const originalMin = objRef.userData.originalBoxMin as THREE.Vector3;
      const originalMax = objRef.userData.originalBoxMax as THREE.Vector3;
      const sensitivity = 0.05;

      // Detect flat axis from the original BRep
      const flatAxis = getFlatAxis(originalBrepRef.current);

      // Check if the handle being dragged is along the flat axis
      if (activeHandle === flatAxis) {
        // Extrusion / flat-axis handling
        const axisRange = (originalMax as any)[flatAxis] - (originalMin as any)[flatAxis];
        const isFlat = Math.abs(axisRange) < 0.11;

        const worldDelta = currentPoint.clone().sub(startPointRef.current);
        const dirVec = new THREE.Vector3(
          flatAxis === "x" ? direction : 0,
          flatAxis === "y" ? direction : 0,
          flatAxis === "z" ? direction : 0
        ).applyQuaternion(camera!.quaternion);
        const dragDistance = worldDelta.dot(dirVec);
        const extrusionDepth = Math.max(0.1, Math.abs(dragDistance));

        if (isFlat && (objRef.userData.originalScale as THREE.Vector3).getComponent(
          flatAxis === "x" ? 0 : flatAxis === "y" ? 1 : 2
        ) === 1) {
          // extrusion for flat shapes
          if (objRef instanceof THREE.Mesh) {
            extrusionParamsRef.current = {
              depth: extrusionDepth,
              direction,
            };

            if (!objRef.userData.extruded) {
              const originalPosition = objRef.position.clone();

              const extrudedObj = extrudeThreeJsObject(
                objRef,
                extrusionDepth,
                direction
              );

              extrudedObj.userData = { ...objRef.userData, extruded: true };
              extrudedObj.userData.nodeId = objRef.userData.nodeId;
              extrudedObj.userData.originalPosition = originalPosition.clone();
              extrudedObj.position.copy(originalPosition);

              if (objRef.parent) {
                objRef.parent.remove(objRef);
              }

              scene!.add(extrudedObj);
              objectsMap.set(element.nodeId, extrudedObj);
              objRef = extrudedObj;

              forceSceneUpdate();
            } else {
              // Scale along the flat axis
              const comp = flatAxis === "x" ? 0 : flatAxis === "y" ? 1 : 2;
              const s = objRef.scale.clone();
              s.setComponent(comp, extrusionDepth);
              objRef.scale.copy(s);
            }
          }
        } else {
          // regular scaling for 3D objects along this axis
          const comp = flatAxis === "x" ? 0 : flatAxis === "y" ? 1 : 2;
          const rawDragAmount = (delta as any)[flatAxis];
          const dragAmount = direction * rawDragAmount;
          const scaleFactor = Math.max(0.1, 1 + dragAmount * sensitivity);

          const s = objRef.scale.clone();
          s.setComponent(comp, scaleFactor * (objRef.userData.originalScale as THREE.Vector3).getComponent(comp));
          objRef.scale.copy(s);

          const originalExtent = (originalMax as any)[flatAxis] - (originalMin as any)[flatAxis];
          const newExtent = originalExtent * scaleFactor;
          const positionOffset = (newExtent - originalExtent) / 2;
          const p = objRef.position.clone();
          (p as any)[flatAxis] = (objRef.userData.originalPosition as THREE.Vector3).getComponent(comp) + direction * positionOffset;
          objRef.position.copy(p);
        }
      } else {
        // Non-flat axis: regular scaling (x or y for Z-flat, etc.)
        const axis = activeHandle as "x" | "y" | "z";
        const comp = axis === "x" ? 0 : axis === "y" ? 1 : 2;
        const rawDragAmount = (delta as any)[axis];
        const dragAmount = direction * rawDragAmount;
        const scaleFactor = Math.max(0.1, 1 + dragAmount * sensitivity);

        const s = objRef.scale.clone();
        s.setComponent(comp, scaleFactor * (objRef.userData.originalScale as THREE.Vector3).getComponent(comp));
        objRef.scale.copy(s);

        const originalExtent = (originalMax as any)[axis] - (originalMin as any)[axis];
        const newExtent = originalExtent * scaleFactor;
        const positionOffset = (newExtent - originalExtent) / 2;
        const p = objRef.position.clone();
        (p as any)[axis] = (objRef.userData.originalPosition as THREE.Vector3).getComponent(comp) + direction * positionOffset;
        objRef.position.copy(p);
      }

      updateElementPosition(selectedElement, objRef.position);
      updateHandlePositions(objRef);
      forceSceneUpdate();
    },
    [
      isResizing,
      activeHandle,
      selectedElement,
      elements,
      getObject,
      getMouseIntersection,
      updateElementPosition,
      forceSceneUpdate,
    ]
  );
  const updateHandlePositions = useCallback((obj: THREE.Object3D) => {
    if (!resizeHandlesRef.current.length) return;

    const bbox = new THREE.Box3().setFromObject(obj);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    const size = new THREE.Vector3();
    bbox.getSize(size);
    const handleSize = Math.min(size.x, size.y, size.z) * 0.2;

    // Detect flat axis from the original BRep
    const flatAxis = originalBrepRef.current ? getFlatAxis(originalBrepRef.current) : "z";

    let newHandleGeometry: THREE.BoxGeometry | null = null;

    resizeHandlesRef.current.forEach((handle) => {
      const axis = handle.userData.axis as "x" | "y" | "z";
      const dir = handle.userData.direction;

      // Position handle at the edge of the bounding box along its axis
      handle.position.set(center.x, center.y, center.z);
      if (axis === "x") {
        handle.position.x = dir > 0 ? bbox.max.x : bbox.min.x;
      } else if (axis === "y") {
        handle.position.y = dir > 0 ? bbox.max.y : bbox.min.y;
      } else {
        handle.position.z = dir > 0 ? bbox.max.z : bbox.min.z;
      }

      // Special styling for handles along the flat axis
      if (axis === flatAxis) {
        const axisRange = (bbox.max as any)[flatAxis] - (bbox.min as any)[flatAxis];
        const isFlat = Math.abs(axisRange) < 0.01;
        if (isFlat) {
          (handle as THREE.Mesh).material = new THREE.MeshBasicMaterial({
            color: RESIZE.previewWireframe,
          });
          // Offset flat-axis handles slightly so they're visible
          if (axis === "x") {
            handle.position.x = dir > 0 ? bbox.max.x + 0.1 : bbox.min.x - 0.1;
          } else if (axis === "y") {
            handle.position.y = dir > 0 ? bbox.max.y + 0.1 : bbox.min.y - 0.1;
          } else {
            handle.position.z = dir > 0 ? bbox.max.z + 0.1 : bbox.min.z - 0.1;
          }
        } else {
          (handle as THREE.Mesh).material = new THREE.MeshBasicMaterial({
            color: RESIZE.handle,
          });
        }
      }

      if (handle instanceof THREE.Mesh) {
        if (!newHandleGeometry) {
          newHandleGeometry = new THREE.BoxGeometry(
            handleSize,
            handleSize,
            handleSize
          );
        }

        handle.geometry.dispose();
        handle.geometry = newHandleGeometry;
      }
    });
  }, []);

  const handleMouseUp = useCallback(async () => {
    if (!isResizing || !selectedElement) return;

    const element = elements.find((el) => el.nodeId === selectedElement);
    const obj = element ? getObject(element.nodeId) : null;

    if (element && obj && originalBrepRef.current) {
      try {
        // For X/Y resizing, use the current (preview-modified) position
        // For flat-axis extrusion, we'll calculate position separately using originalPosition + offset
        let currentPosition = obj.position.clone();

        const flatAxis = getFlatAxis(originalBrepRef.current);

        if (activeHandle === flatAxis && extrusionParamsRef.current) {
          const { direction } = extrusionParamsRef.current;

          // Check if original BRep was flat along its flat axis
          const verts = originalBrepRef.current.vertices;
          const flatCoords = verts.map((v) => (v as any)[flatAxis] as number);
          const wasFlat = verts.length >= 2 &&
            Math.abs(Math.max(...flatCoords) - Math.min(...flatCoords)) < 0.11;

          if (wasFlat && obj.userData.extruded) {
            const bbox = new THREE.Box3().setFromObject(obj);
            const actualSize = new THREE.Vector3();
            bbox.getSize(actualSize);

            const actualExtrusionHeight = flatAxis === "x" ? actualSize.x
              : flatAxis === "y" ? actualSize.y
              : actualSize.z;

            // extrudeBRep returns centered BRep + position offset (bounding box center)
            const extrusionResult = await extrudeBRep(
              originalBrepRef.current,
              actualExtrusionHeight,
              direction
            );

            element.brep = extrusionResult.brep;
            (element as any).userData = (element as any).userData || {};
            (element as any).userData.brepExtruded = true;

            // Use ORIGINAL position + offset (not preview-modified position)
            const originalPosition = obj.userData.originalPosition?.clone() || obj.position.clone();

            currentPosition = new THREE.Vector3(
              originalPosition.x + extrusionResult.positionOffset.x,
              originalPosition.y + extrusionResult.positionOffset.y,
              originalPosition.z + extrusionResult.positionOffset.z
            );
          }
        }

        updateElementPosition(selectedElement, currentPosition);

        delete obj.userData.originalBoxMin;
        delete obj.userData.originalBoxMax;
        delete obj.userData.originalPosition;
        delete obj.userData.originalScale;

        createResizeHandles(selectedElement);
        forceSceneUpdate();
      } catch (error) {
        console.error("resize error:", error);

        if (originalBrepRef.current) {
          obj.scale.set(1, 1, 1);
          createResizeHandles(selectedElement);
          forceSceneUpdate();
        }
      }
    }

    setIsResizing(false);
    setActiveHandle(null);
    setActiveHandleDirection(null);
    extrusionParamsRef.current = null;
    startPointRef.current = null;
    originalBrepRef.current = null;
  }, [
    isResizing,
    selectedElement,
    activeHandle,
    elements,
    getObject,
    updateElementPosition,
    createResizeHandles,
    forceSceneUpdate,
  ]);
  const cleanup = useCallback(() => {
    cleanupHandles();
    setSelectedElement(null);
    setIsResizing(false);
    setActiveHandle(null);
    setActiveHandleDirection(null);

    startPointRef.current = null;
    originalBrepRef.current = null;
  }, [cleanupHandles]);

  return {
    selectedElement,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    cleanup,
  };
}
