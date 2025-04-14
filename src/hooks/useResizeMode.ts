// src/hooks/useResizeMode.ts
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { transformBrepVertices } from "../convertBRepToGeometry";
import { Brep } from "../geometry";

export function useResizeMode() {
  const { elements, getObject, updateElementPosition } = useCadCore();
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
      const handleSize = Math.min(size.x, size.y, size.z) * 2.2;
      const handleGeometry = new THREE.BoxGeometry(
        handleSize,
        handleSize,
        handleSize
      );
      const handleMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });

      // Create 6 handles (one for each direction: +x, -x, +y, -y, +z, -z)
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
              console.log({ selectedElement });
              console.log({ el });
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

      const obj = getObject(selectedElement);
      if (!obj) return;

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
      if (!obj.userData.originalBoxMin || !obj.userData.originalBoxMax) {
        const bbox = new THREE.Box3().setFromObject(obj);
        obj.userData.originalBoxMin = bbox.min.clone();
        obj.userData.originalBoxMax = bbox.max.clone();
        obj.userData.originalPosition = obj.position.clone();
        obj.userData.originalScale = obj.scale.clone();
      }

      const originalMin = obj.userData.originalBoxMin;
      const originalMax = obj.userData.originalBoxMax;
      const sensitivity = 0.05;

      // Calculate new scale based on drag amount
      if (activeHandle === "x") {
        // THIS IS THE KEY FIX: Calculate proper drag amount and position adjustment
        const rawDragAmount = delta.x;
        const dragAmount = direction * rawDragAmount; // This flips sign for negative direction
        const scaleFactor = Math.max(0.1, 1 + dragAmount * sensitivity);

        // Apply scale to x dimension
        obj.scale.x = scaleFactor * obj.userData.originalScale.x;

        const originalWidth = originalMax.x - originalMin.x;
        const newWidth = originalWidth * scaleFactor;

        console.log(direction);

        // THIS IS THE IMPORTANT CHANGE:
        // Adjust position differently for right vs. left handle
        if (direction > 0) {
          // Right handle
          // Move half the growth to the right
          const positionOffset = (newWidth - originalWidth) / 2;
          obj.position.x = obj.userData.originalPosition.x + positionOffset;
        } else {
          // Left handle
          // Move half the growth to the left
          const positionOffset = (newWidth - originalWidth) / 2;
          obj.position.x = obj.userData.originalPosition.x - positionOffset;
        }
      } else if (activeHandle === "y") {
        // Similar fix for Y axis
        const rawDragAmount = delta.y;
        const dragAmount = direction * rawDragAmount; // This flips sign for negative direction
        const scaleFactor = Math.max(0.1, 1 + dragAmount * sensitivity);

        // Apply scale to y dimension
        obj.scale.y = scaleFactor * obj.userData.originalScale.y;

        const originalHeight = originalMax.y - originalMin.y;
        const newHeight = originalHeight * scaleFactor;

        // Adjust position differently for top vs. bottom handle
        if (direction > 0) {
          // Top handle
          // Move half the growth upward
          const positionOffset = (newHeight - originalHeight) / 2;
          obj.position.y = obj.userData.originalPosition.y + positionOffset;
        } else {
          // Bottom handle
          // Move half the growth downward
          const positionOffset = (newHeight - originalHeight) / 2;
          obj.position.y = obj.userData.originalPosition.y - positionOffset;
        }
      } else if (activeHandle === "z") {
        // Check if the object is essentially 2D (flat in Z dimension)
        const isFlat = Math.abs(originalMax.z - originalMin.z) < 0.01;

        // Similar fix for Z axis
        console.log("Z axis resize");

        // Use Y mouse movement for Z control
        const rawDragAmount = -delta.y; // Negative makes upward motion grow in +Z
        const dragAmount = direction * rawDragAmount;

        // If flat, we need a special case for the first Z resize
        let scaleFactor;
        if (isFlat && obj.userData.originalScale.z === 1) {
          // For flat objects, don't use scale factor but direct value
          // This creates an initial extrusion
          const extrusionDepth = Math.abs(dragAmount) * sensitivity * 20; // Amplify for better visibility
          scaleFactor = extrusionDepth;

          // Set a minimum extrusion to avoid scale issues
          scaleFactor = Math.max(0.1, scaleFactor);

          // For flat objects being extruded, set scale directly rather than multiplying
          obj.scale.z = scaleFactor;
        } else {
          // Normal scaling for already 3D objects
          scaleFactor = Math.max(0.1, 1 + dragAmount * sensitivity);
          obj.scale.z = scaleFactor * obj.userData.originalScale.z;
        }

        const originalDepth = originalMax.z - originalMin.z;
        const newDepth = originalDepth * scaleFactor;

        // Adjust position differently for front vs. back handle
        if (direction > 0) {
          // Front handle
          const positionOffset = (newDepth - originalDepth) / 2;
          obj.position.z = obj.userData.originalPosition.z + positionOffset;
        } else {
          // Back handle
          const positionOffset = (newDepth - originalDepth) / 2;
          obj.position.z = obj.userData.originalPosition.z - positionOffset;
        }
      }

      updateElementPosition(selectedElement, obj.position);
      updateHandlePositions(obj);
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
  // Helper function to update handle positions without recreating them
  const updateHandlePositions = useCallback((obj: THREE.Object3D) => {
    if (!resizeHandlesRef.current.length) return;

    const bbox = new THREE.Box3().setFromObject(obj);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    resizeHandlesRef.current.forEach((handle) => {
      const axis = handle.userData.axis;
      const dir = handle.userData.direction;

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
