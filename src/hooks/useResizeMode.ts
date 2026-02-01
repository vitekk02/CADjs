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
      const handleMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });

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

      const objects: THREE.Object3D[] = [];
      elements.forEach((el) => {
        const obj = getObject(el.nodeId);
        if (obj) objects.push(obj);
      });

      const intersects = raycaster.intersectObjects(objects, true);
      if (intersects.length > 0) {
        const pickedObject = intersects[0].object;

        for (const el of elements) {
          const obj = getObject(el.nodeId);
          if (
            obj === pickedObject ||
            (pickedObject.parent && obj === pickedObject.parent)
          ) {
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

      const originalMin = objRef.userData.originalBoxMin;
      const originalMax = objRef.userData.originalBoxMax;
      const sensitivity = 0.05;

      if (activeHandle === "x") {
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
        // check if flat (2D shape)
        const isFlat = Math.abs(originalMax.z - originalMin.z) < 0.11;

        const worldDelta = currentPoint.clone().sub(startPointRef.current);
        const extrusionVector = new THREE.Vector3(
          0,
          0,
          direction
        ).applyQuaternion(camera.quaternion);
        const dragDistance = worldDelta.dot(extrusionVector);
        const extrusionDepth = Math.max(0.1, Math.abs(dragDistance));

        if (isFlat && objRef.userData.originalScale.z === 1) {
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

              scene.add(extrudedObj);
              objectsMap.set(element.nodeId, extrudedObj);
              objRef = extrudedObj;

              forceSceneUpdate();
            } else {
              objRef.scale.z = extrusionDepth;
            }
          }
        } else {
          // regular z scaling for 3d objects
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

    const size = new THREE.Vector3();
    bbox.getSize(size);
    const handleSize = Math.min(size.x, size.y, size.z) * 0.2;

    let newHandleGeometry: THREE.BoxGeometry | null = null;

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
          // pink for flat objects
          (handle as THREE.Mesh).material = new THREE.MeshBasicMaterial({
            color: 0xff00ff,
          });
          handle.position.z = dir > 0 ? bbox.max.z + 0.1 : bbox.min.z - 0.1;
        } else {
          (handle as THREE.Mesh).material = new THREE.MeshBasicMaterial({
            color: 0xffff00,
          });
          handle.position.z = dir > 0 ? bbox.max.z : bbox.min.z;
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

  const handleMouseUp = useCallback(() => {
    if (!isResizing || !selectedElement) return;

    const element = elements.find((el) => el.nodeId === selectedElement);
    const obj = element ? getObject(element.nodeId) : null;

    if (element && obj && originalBrepRef.current) {
      try {
        const finalScale = obj.scale.clone();
        const currentPosition = obj.position.clone();

        if (activeHandle === "z" && extrusionParamsRef.current) {
          const { depth, direction } = extrusionParamsRef.current;

          const bbox = new THREE.Box3().setFromObject(obj);
          const size = new THREE.Vector3();
          bbox.getSize(size);
          const wasFlat =
            Math.abs(
              originalBrepRef.current.vertices[0].z -
                originalBrepRef.current.vertices[1].z
            ) < 0.11;

          if (wasFlat && obj.userData.extruded) {
            const bbox = new THREE.Box3().setFromObject(obj);
            const actualSize = new THREE.Vector3();
            bbox.getSize(actualSize);

            const actualExtrusionHeight = actualSize.z;

            const extrudedBrep = extrudeBRep(
              originalBrepRef.current,
              actualExtrusionHeight,
              direction
            );

            element.brep = extrudedBrep;
            (element as any).userData = (element as any).userData || {};
            (element as any).userData.brepExtruded = true;
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
