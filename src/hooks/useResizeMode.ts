// src/hooks/useResizeMode.ts
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { transformBrepVertices } from "../convertBRepToGeometry";
import { Brep } from "../geometry";
import {
  extrudeBRep,
  extrudeThreeJsObject,
} from "../scene-operations/resize-operations";

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

  // Create resize handles for the selected element
  const createResizeHandles = useCallback(
    (nodeId: string) => {
      if (!scene) return;

      // Clean up previous handles
      cleanupHandles();

      const element = elements.find((el) => el.nodeId === nodeId);
      if (!element) return;

      const obj = getObject(nodeId);
      if (!obj) return;

      // Calculate the element's bounding box
      const bbox = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      // Create handles for each axis
      const handleSize = 0.2; // Use fixed size instead of scaling with object
      const handleGeometry = new THREE.BoxGeometry(
        handleSize,
        handleSize,
        handleSize
      );
      const handleMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });

      // Create 6 handles (one for each face: +x, -x, +y, -y, +z, -z)
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

      // Store the original BRep for reference
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

  // Clean up all resize handles
  const cleanupHandles = useCallback(() => {
    if (scene) {
      resizeHandlesRef.current.forEach((handle) => {
        scene.remove(handle);
      });
      resizeHandlesRef.current = [];
    }
  }, [scene]);

  // Handle mouse down - select element or handle
  const handleMouseDown = useCallback(
    (event: MouseEvent) => {
      if (!camera || !renderer || event.button !== 0) return;

      // Create raycaster for object selection
      const raycaster = new THREE.Raycaster();
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);

      // First check if we hit a resize handle
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

      // If not a handle, try to select an element
      const objects: THREE.Object3D[] = [];
      elements.forEach((el) => {
        const obj = getObject(el.nodeId);
        if (obj) objects.push(obj);
      });

      const intersects = raycaster.intersectObjects(objects, true);
      if (intersects.length > 0) {
        const pickedObject = intersects[0].object;

        // Find which element was clicked
        for (const el of elements) {
          const obj = getObject(el.nodeId);
          if (
            obj === pickedObject ||
            (pickedObject.parent && obj === pickedObject.parent)
          ) {
            // Only update if selection changed (prevents unnecessary rerenders)
            if (selectedElement !== el.nodeId) {
              setSelectedElement(el.nodeId);
              // Remove the direct call to createResizeHandles here
            }
            event.stopPropagation(); // Prevent event bubbling
            break;
          }
        }
      } else {
        // Clicked empty space, clear selection
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

  // In the useResizeMode function, add this ref
  const extrusionParamsRef = useRef<{
    depth: number;
    direction: number;
  } | null>(null);

  // Then modify handleMouseMove
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

      // Change from const to let so we can reassign it later
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

      const direction = activeHandleObj.userData.direction; // 1 or -1

      // Store current state to avoid recalculation
      if (!objRef.userData.originalBoxMin || !objRef.userData.originalBoxMax) {
        const bbox = new THREE.Box3().setFromObject(objRef);
        objRef.userData.originalBoxMin = bbox.min.clone();
        objRef.userData.originalBoxMax = bbox.max.clone();
        objRef.userData.originalPosition = objRef.position.clone();
        objRef.userData.originalScale = objRef.scale.clone();
      }

      const originalMin = objRef.userData.originalBoxMin;
      const originalMax = objRef.userData.originalBoxMax;
      const sensitivity = 0.05;

      if (activeHandle === "x") {
        // X-axis scaling (unchanged)
        const rawDragAmount = delta.x;
        const dragAmount = direction * rawDragAmount;
        const scaleFactor = Math.max(0.1, 1 + dragAmount * sensitivity);

        objRef.scale.x = scaleFactor * objRef.userData.originalScale.x;

        const originalWidth = originalMax.x - originalMin.x;
        const newWidth = originalWidth * scaleFactor;

        const positionOffset = (newWidth - originalWidth) / 2;
        objRef.position.x =
          objRef.userData.originalPosition.x + direction * positionOffset;
      } else if (activeHandle === "y") {
        // Y-axis scaling (unchanged)
        const rawDragAmount = delta.y;
        const dragAmount = direction * rawDragAmount;
        const scaleFactor = Math.max(0.1, 1 + dragAmount * sensitivity);

        objRef.scale.y = scaleFactor * objRef.userData.originalScale.y;

        const originalHeight = originalMax.y - originalMin.y;
        const newHeight = originalHeight * scaleFactor;

        const positionOffset = (newHeight - originalHeight) / 2;
        objRef.position.y =
          objRef.userData.originalPosition.y + direction * positionOffset;
      } else if (activeHandle === "z") {
        // Check if the object is essentially 2D (flat in Z dimension)
        const isFlat = Math.abs(originalMax.z - originalMin.z) < 0.11;

        // Calculate direct world space distance for extrusion
        const worldDelta = currentPoint.clone().sub(startPointRef.current);

        // Project the delta onto the extrusion direction vector
        const extrusionVector = new THREE.Vector3(
          0,
          0,
          direction
        ).applyQuaternion(camera.quaternion);
        const dragDistance = worldDelta.dot(extrusionVector);

        // Calculate extrusion depth directly from cursor movement
        const extrusionDepth = Math.max(0.1, Math.abs(dragDistance));

        // Store these parameters for mouseUp handler

        if (isFlat && objRef.userData.originalScale.z === 1) {
          // EXTRUSION CASE - only handle THREE.js object visually
          if (objRef instanceof THREE.Mesh) {
            // Store extrusion parameters for mouseUp
            extrusionParamsRef.current = {
              depth: extrusionDepth,
              direction,
            };

            if (!objRef.userData.extruded) {
              // First extrusion - create the extruded object
              const originalPosition = objRef.position.clone();

              const extrudedObj = extrudeThreeJsObject(
                objRef,
                extrusionDepth,
                direction
              );

              extrudedObj.userData = { ...objRef.userData, extruded: true };
              extrudedObj.userData.nodeId = objRef.userData.nodeId;
              extrudedObj.userData.originalPosition = originalPosition.clone();

              // Important: Position correctly in space
              extrudedObj.position.copy(originalPosition);

              if (objRef.parent) {
                objRef.parent.remove(objRef);
              }

              scene.add(extrudedObj);
              objectsMap.set(element.nodeId, extrudedObj);
              objRef = extrudedObj;

              forceSceneUpdate();
            } else {
              // Subsequent adjustments
              objRef.scale.z = extrusionDepth;
            }
          }
          // NOTE: We no longer modify BRep here - it will be done in mouseUp
        } else {
          // Regular Z scaling for 3D objects
          const rawDragAmount = delta.z;
          const dragAmount = direction * rawDragAmount;
          const scaleFactor = Math.max(0.1, 1 + dragAmount * sensitivity);

          objRef.scale.z = scaleFactor * objRef.userData.originalScale.z;

          const originalDepth = originalMax.z - originalMin.z;
          const newDepth = originalDepth * scaleFactor;

          const positionOffset = (newDepth - originalDepth) / 2;
          objRef.position.z =
            objRef.userData.originalPosition.z + direction * positionOffset;
        }
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

    // Calculate new handle size based on object dimensions
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const handleSize = Math.min(size.x, size.y, size.z) * 0.2; // Reduced multiplier from 2.2 to 0.2

    // Create geometry only once and reuse
    let newHandleGeometry: THREE.BoxGeometry | null = null;

    resizeHandlesRef.current.forEach((handle) => {
      const axis = handle.userData.axis;
      const dir = handle.userData.direction;

      // Update handle positions
      if (axis === "x") {
        handle.position.x = dir > 0 ? bbox.max.x : bbox.min.x;
        handle.position.y = center.y;
        handle.position.z = center.z;
      } else if (axis === "y") {
        handle.position.x = center.x;
        handle.position.y = dir > 0 ? bbox.max.y : bbox.min.y;
        handle.position.z = center.z;
      } else if (axis === "z") {
        const isFlat = Math.abs(bbox.max.z - bbox.min.z) < 0.01;
        if (isFlat) {
          // Make Z handles stand out more for flat objects
          (handle as THREE.Mesh).material = new THREE.MeshBasicMaterial({
            color: 0xff00ff,
          });

          // Position them slightly offset from the object to be visible
          handle.position.z = dir > 0 ? bbox.max.z + 0.1 : bbox.min.z - 0.1;
        } else {
          (handle as THREE.Mesh).material = new THREE.MeshBasicMaterial({
            color: 0xffff00,
          });
          handle.position.z = dir > 0 ? bbox.max.z : bbox.min.z;
        }
      }

      // Update handle size
      if (handle instanceof THREE.Mesh) {
        // Create new geometry only once
        if (!newHandleGeometry) {
          newHandleGeometry = new THREE.BoxGeometry(
            handleSize,
            handleSize,
            handleSize
          );
        }

        // Replace the geometry with the new sized one
        handle.geometry.dispose(); // Clean up old geometry
        handle.geometry = newHandleGeometry;
      }
    });
  }, []);
  // Handle mouse up - complete resize operation
  const handleMouseUp = useCallback(() => {
    if (!isResizing || !selectedElement) return;

    const element = elements.find((el) => el.nodeId === selectedElement);
    const obj = element ? getObject(element.nodeId) : null;

    if (element && obj && originalBrepRef.current) {
      try {
        const finalScale = obj.scale.clone();
        const currentPosition = obj.position.clone();

        // Now handle BRep extrusion if we were extruding along Z
        if (activeHandle === "z" && extrusionParamsRef.current) {
          const { depth, direction } = extrusionParamsRef.current;

          // Check if this was an extrusion operation
          const bbox = new THREE.Box3().setFromObject(obj);
          const size = new THREE.Vector3();
          bbox.getSize(size);
          const wasFlat =
            Math.abs(
              originalBrepRef.current.vertices[0].z -
                originalBrepRef.current.vertices[1].z
            ) < 0.11;

          if (wasFlat && obj.userData.extruded) {
            // Get the actual world dimensions of the extruded object
            const bbox = new THREE.Box3().setFromObject(obj);
            const actualSize = new THREE.Vector3();
            bbox.getSize(actualSize);

            // Use the Z dimension as the extrusion height - this is the ACTUAL size
            const actualExtrusionHeight = actualSize.z;
            console.log(
              "Actual extrusion height from bbox:",
              actualExtrusionHeight
            );

            // Now perform the BRep extrusion with the correct absolute height
            const extrudedBrep = extrudeBRep(
              originalBrepRef.current,
              actualExtrusionHeight,
              direction
            );

            // Store it
            element.brep = extrudedBrep;
            (element as any).userData = (element as any).userData || {};
            (element as any).userData.brepExtruded = true;

            console.log(
              "BRep extrusion completed on mouseUp with height:",
              actualExtrusionHeight
            );
          }
        }

        // Update position in the data model
        updateElementPosition(selectedElement, currentPosition);

        // Clean up stored values
        delete obj.userData.originalBoxMin;
        delete obj.userData.originalBoxMax;
        delete obj.userData.originalPosition;
        delete obj.userData.originalScale;

        createResizeHandles(selectedElement);
        forceSceneUpdate();
      } catch (error) {
        console.error("Error finalizing resize operation:", error);

        if (originalBrepRef.current) {
          obj.scale.set(1, 1, 1);
          createResizeHandles(selectedElement);
          forceSceneUpdate();
        }
      }
    }

    // Reset state
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
