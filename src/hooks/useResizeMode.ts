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

  // Handle mouse move - resize if dragging a handle
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

      // Calculate new scale based on drag amount
      if (activeHandle === "x") {
        // THIS IS THE KEY FIX: Calculate proper drag amount and position adjustment
        const rawDragAmount = delta.x;
        const dragAmount = direction * rawDragAmount; // This flips sign for negative direction
        const scaleFactor = Math.max(0.1, 1 + dragAmount * sensitivity);

        // Apply scale to x dimension
        objRef.scale.x = scaleFactor * objRef.userData.originalScale.x;

        const originalWidth = originalMax.x - originalMin.x;
        const newWidth = originalWidth * scaleFactor;

        // THIS IS THE IMPORTANT CHANGE:
        // Adjust position differently for right vs. left handle
        if (direction > 0) {
          // Right handle
          // Move half the growth to the right
          const positionOffset = (newWidth - originalWidth) / 2;
          objRef.position.x =
            objRef.userData.originalPosition.x + positionOffset;
        } else {
          // Left handle
          // Move half the growth to the left
          const positionOffset = (newWidth - originalWidth) / 2;
          objRef.position.x =
            objRef.userData.originalPosition.x - positionOffset;
        }
      } else if (activeHandle === "y") {
        // Similar fix for Y axis
        const rawDragAmount = delta.y;
        const dragAmount = direction * rawDragAmount; // This flips sign for negative direction
        const scaleFactor = Math.max(0.1, 1 + dragAmount * sensitivity);

        // Apply scale to y dimension
        objRef.scale.y = scaleFactor * objRef.userData.originalScale.y;

        const originalHeight = originalMax.y - originalMin.y;
        const newHeight = originalHeight * scaleFactor;

        // Adjust position differently for top vs. bottom handle
        if (direction > 0) {
          // Top handle
          // Move half the growth upward
          const positionOffset = (newHeight - originalHeight) / 2;
          objRef.position.y =
            objRef.userData.originalPosition.y + positionOffset;
        } else {
          // Bottom handle
          // Move half the growth downward
          const positionOffset = (newHeight - originalHeight) / 2;
          objRef.position.y =
            objRef.userData.originalPosition.y - positionOffset;
        }
      } else if (activeHandle === "z") {
        // Check if the object is essentially 2D (flat in Z dimension)
        const isFlat = Math.abs(originalMax.z - originalMin.z) < 0.11;

        // Calculate direct world space distance for extrusion
        // This makes extrusion follow cursor more naturally
        const worldDelta = currentPoint.clone().sub(startPointRef.current);

        // Project the delta onto the extrusion direction vector
        // Use camera's up vector to determine extrusion direction more intuitively
        const extrusionVector = new THREE.Vector3(
          0,
          0,
          direction
        ).applyQuaternion(camera.quaternion);
        const dragDistance = worldDelta.dot(extrusionVector);

        // Calculate extrusion depth directly from cursor movement
        const extrusionDepth = Math.max(0.1, Math.abs(dragDistance));

        if (isFlat && objRef.userData.originalScale.z === 1) {
          // EXTRUSION CASE
          console.log(
            `Extruding by ${extrusionDepth} in direction ${direction}`
          );

          // Handle THREE.js object extrusion
          if (objRef instanceof THREE.Mesh) {
            // Replace with extruded version if this is our first extrusion
            if (!objRef.userData.extruded) {
              // Store original for cleanup
              const originalObj = objRef.clone();
              const originalPosition = objRef.position.clone();

              // Create the extruded object
              const extrudedObj = extrudeThreeJsObject(
                objRef,
                extrusionDepth,
                direction
              );

              // Copy important userData from original to new object
              extrudedObj.userData = { ...objRef.userData, extruded: true };
              extrudedObj.userData.nodeId = objRef.userData.nodeId;
              extrudedObj.userData.originalPosition = originalPosition.clone();

              // IMPORTANT: Preserve original position - exactly as it was
              extrudedObj.position.copy(originalPosition);

              // Remove the old object from scene
              if (objRef.parent) {
                objRef.parent.remove(objRef);
              }

              // Add new object to scene
              scene.add(extrudedObj);

              // Update reference in objectsMap
              const nodeId = element.nodeId;
              objectsMap.set(nodeId, extrudedObj);

              // Update our working reference
              objRef = extrudedObj;

              // Force a scene update
              forceSceneUpdate();
            } else {
              // For subsequent adjustments to already extruded objects:
              objRef.scale.z = extrusionDepth;
            }
          }

          // Handle BRep extrusion
          if (originalBrepRef.current && element) {
            // Only extrude BRep on first extrusion operation
            if (!(element as any).userData?.brepExtruded) {
              // Create extruded BRep
              const extrudedBrep = extrudeBRep(
                originalBrepRef.current,
                extrusionDepth,
                direction
              );

              // Store it
              element.brep = extrudedBrep;
              (element as any).userData = (element as any).userData || {};
              (element as any).userData.brepExtruded = true;
            }
          }

          // Update position based on extrusion direction
          // if (direction > 0) {
          //   objRef.position.z =
          //     objRef.userData.originalPosition.z + extrusionDepth / 2;
          // } else {
          //   objRef.position.z =
          //     objRef.userData.originalPosition.z - extrusionDepth / 2;
          // }
        } else {
          // SCALING CASE - Normal scaling for already 3D objects
          const rawDragAmount = delta.z;
          const dragAmount = direction * rawDragAmount; // This flips sign for negative direction
          const scaleFactor = Math.max(0.1, 1 + dragAmount * sensitivity);
          objRef.scale.z = scaleFactor * objRef.userData.originalScale.z;
          const originalDepth = originalMax.z - originalMin.z;
          const newDepth = originalDepth * scaleFactor;
          // Adjust position based on which handle was dragged
          if (direction > 0) {
            const positionOffset = (newDepth - originalDepth) / 2;
            objRef.position.z =
              objRef.userData.originalPosition.z + positionOffset;
          } else {
            const positionOffset = (newDepth - originalDepth) / 2;
            objRef.position.z =
              objRef.userData.originalPosition.z - positionOffset;
          }
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
        // Get the final scale that was applied
        const finalScale = obj.scale.clone();
        console.log("Final scale applied:", finalScale);

        // Important - store the CURRENT position before any transformations
        const currentPosition = obj.position.clone();

        // Instead of trying to transform the original BRep with a scale matrix,
        // we'll keep the current scale and position of the object as is

        // This is the key fix: DON'T reset the scale to (1,1,1)
        // We'll leave the visual object with its current scale

        // Update position in the data model to ensure everything is consistent
        updateElementPosition(selectedElement, currentPosition);

        // Clean up stored values for the next resize operation
        delete obj.userData.originalBoxMin;
        delete obj.userData.originalBoxMax;
        delete obj.userData.originalPosition;
        delete obj.userData.originalScale;

        // Force a visual update but keep the current scale
        createResizeHandles(selectedElement);
        forceSceneUpdate();

        console.log("Resize complete, current scale:", obj.scale);
      } catch (error) {
        console.error("Error finalizing resize operation:", error);

        // Restore original state if there was an error
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

    startPointRef.current = null;
    originalBrepRef.current = null;
  }, [
    isResizing,
    selectedElement,
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
