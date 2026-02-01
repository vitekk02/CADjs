import { useRef, useState, useEffect, useCallback } from "react";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { SceneElement } from "../scene-operations/types";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";

interface MoveModeState {
  selectedObject: string | null;
  contextMenu: { visible: boolean; x: number; y: number; nodeId: string | null };
  isRotating: boolean;
}

interface MoveModeActions {
  handleMouseDown: (event: MouseEvent) => void;
  handleMouseMove: (event: MouseEvent) => void;
  handleMouseUp: (event: MouseEvent) => void;
  updateContextMenuPosition: (nodeId: string | null) => void;
  clearSelection: () => void;
}

const useMoveMode = (): [MoveModeState, MoveModeActions] => {
  const { elements, getObject, updateElementPosition, updateElementRotation } =
    useCadCore();

  const {
    camera,
    renderer,
    scene,
    controls: orbitControls,
    forceSceneUpdate,
    showGroundPlane,
  } = useCadVisualizer();

  const showGroundPlaneRef = useRef(showGroundPlane);

  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const selectedObjectRef = useRef<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    nodeId: string | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    nodeId: null,
  });

  const [isRotating, setIsRotating] = useState<boolean>(false);
  const [shiftKeyPressed, setShiftKeyPressed] = useState<boolean>(false);

  const updateElementPositionRef = useRef(updateElementPosition);
  const updateElementRotationRef = useRef(updateElementRotation);

  useEffect(() => {
    selectedObjectRef.current = selectedObject;
  }, [selectedObject]);

  useEffect(() => {
    showGroundPlaneRef.current = showGroundPlane;
  }, [showGroundPlane]);

  useEffect(() => {
    updateElementPositionRef.current = updateElementPosition;
    updateElementRotationRef.current = updateElementRotation;
  }, [updateElementPosition, updateElementRotation]);

  const snapPositionToGrid = useCallback(
    (position: THREE.Vector3): THREE.Vector3 => {
      if (showGroundPlane && !shiftKeyPressed) {
        const gridSize = 0.5;
        const newPosition = position.clone();
        newPosition.x = Math.round(newPosition.x / gridSize) * gridSize;
        newPosition.y = Math.round(newPosition.y / gridSize) * gridSize;
        return newPosition;
      }
      return position;
    },
    [showGroundPlane, shiftKeyPressed]
  );

  const snapRotationToIncrement = useCallback(
    (rotation: THREE.Euler): THREE.Euler => {
      if (showGroundPlane && !shiftKeyPressed) {
        const angleIncrement = Math.PI / 12;
        const newRotation = rotation.clone();
        newRotation.x =
          Math.round(newRotation.x / angleIncrement) * angleIncrement;
        newRotation.y =
          Math.round(newRotation.y / angleIncrement) * angleIncrement;
        newRotation.z =
          Math.round(newRotation.z / angleIncrement) * angleIncrement;
        return newRotation;
      }
      return rotation;
    },
    [showGroundPlane, shiftKeyPressed]
  );

  const transformControlsRef = useRef<TransformControls | null>(null);

  useEffect(() => {
    if (!scene || !camera || !renderer) {
      console.error("Scene, camera, or renderer not available");
      return;
    }


    const onDraggingChanged = (event) => {
      if (orbitControls) {
        orbitControls.enabled = !event.value;
      }
    };

    const onObjectChange = () => {
      if (selectedObjectRef.current && transformControlsRef.current?.object) {
        const position = new THREE.Vector3();
        transformControlsRef.current.object.getWorldPosition(position);

        if (
          showGroundPlaneRef.current &&
          transformControlsRef.current.mode === "translate"
        ) {
          const snappedPosition = snapPositionToGrid(position);

          if (!position.equals(snappedPosition)) {
            transformControlsRef.current.object.position.copy(snappedPosition);
          }

          updateElementPositionRef.current(
            selectedObjectRef.current,
            snappedPosition
          );
        } else {
          updateElementPositionRef.current(selectedObjectRef.current, position);
        }

        if (isRotating && transformControlsRef.current.object) {
          const rotation = new THREE.Euler();
          rotation.setFromRotationMatrix(
            new THREE.Matrix4().extractRotation(
              transformControlsRef.current.object.matrixWorld
            )
          );

          if (showGroundPlaneRef.current) {
            const snappedRotation = snapRotationToIncrement(rotation);
            if (!rotation.equals(snappedRotation)) {
              const quaternion = new THREE.Quaternion();
              quaternion.setFromEuler(snappedRotation);
              transformControlsRef.current.object.quaternion.copy(quaternion);
            }
            updateElementRotationRef.current(
              selectedObjectRef.current,
              snappedRotation
            );
          } else {
            updateElementRotationRef.current(
              selectedObjectRef.current,
              rotation
            );
          }
        }
      }
    };

    if (transformControlsRef.current) {
      transformControlsRef.current.removeEventListener(
        "dragging-changed",
        onDraggingChanged
      );
      transformControlsRef.current.removeEventListener(
        "objectChange",
        onObjectChange
      );

      transformControlsRef.current.detach();

      try {
        const gizmo = transformControlsRef.current.getHelper();
        if (scene && gizmo) {
          scene.remove(gizmo);
        }
      } catch (e) {
        // ignore cleanup errors
      }

      transformControlsRef.current.dispose();
      transformControlsRef.current = null;
    }

    try {
      const transformControls = new TransformControls(
        camera,
        renderer.domElement
      );

      transformControls.setMode("translate");
      transformControls.setSpace("world");
      transformControls.setSize(1.25);
      transformControls.enabled = true;

      transformControls.addEventListener("dragging-changed", onDraggingChanged);
      transformControls.addEventListener("objectChange", onObjectChange);

      const gizmo = transformControls.getHelper();
      gizmo.userData.helperType = "gizmo";
      scene.add(gizmo);

      transformControlsRef.current = transformControls;

      forceSceneUpdate();
    } catch (error) {
      // transform controls init failed
    }

    return () => {
      if (transformControlsRef.current) {
        transformControlsRef.current.removeEventListener(
          "dragging-changed",
          onDraggingChanged
        );
        transformControlsRef.current.removeEventListener(
          "objectChange",
          onObjectChange
        );

        transformControlsRef.current.detach();

        try {
          const gizmo = transformControlsRef.current.getHelper();
          if (scene && gizmo) {
            scene.remove(gizmo);
          }
        } catch (e) {
          console.error("Error cleaning up transform controls:", e);
        }

        transformControlsRef.current.dispose();
        transformControlsRef.current = null;
      }
    };
  }, [
    scene,
    camera,
    renderer,
    snapPositionToGrid,
    snapRotationToIncrement,
    isRotating,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        event.preventDefault();
        if (!isRotating && transformControlsRef.current) {
          transformControlsRef.current.setMode("rotate");
          setIsRotating(true);
        }
      }
      if (event.key === "Shift") {
        setShiftKeyPressed(true);
        if (transformControlsRef.current) {
          transformControlsRef.current.setTranslationSnap(null);
          transformControlsRef.current.setRotationSnap(null);
          forceSceneUpdate();
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        if (transformControlsRef.current) {
          transformControlsRef.current.setMode("translate");
          setIsRotating(false);
        }
      }
      if (event.key === "Shift") {
        setShiftKeyPressed(false);
        if (transformControlsRef.current && showGroundPlane) {
          transformControlsRef.current.setTranslationSnap(0.5);
          transformControlsRef.current.setRotationSnap(Math.PI / 12);
          forceSceneUpdate();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [showGroundPlane, isRotating]);

  useEffect(() => {
    const transformControls = transformControlsRef.current;
    if (!transformControls) return;
    if (!scene) return;

    try {
      if (selectedObject) {
        const obj = getObject(selectedObject);
        if (!obj) return;
        if (!(obj instanceof THREE.Object3D)) return;

        transformControls.attach(obj);
        transformControls.visible = true;
        forceSceneUpdate();
      } else {
        transformControls.detach();
      }
    } catch (error) {
      // attach failed
    }
  }, [selectedObject, scene, getObject]);

  // Calculate context menu position at bounding box corner
  const updateContextMenuPosition = (nodeId: string | null) => {
    if (!camera || !renderer || !nodeId || !contextMenu.visible) return;

    const obj = getObject(nodeId);
    if (!obj) return;

    // Calculate the bounding box of the element
    const boundingBox = new THREE.Box3().setFromObject(obj);
    const topRightCorner = new THREE.Vector3(
      boundingBox.max.x,
      boundingBox.max.y,
      boundingBox.max.z
    );

    // Project to screen coordinates
    const tempV = topRightCorner.clone();
    tempV.project(camera);

    // Convert to screen coordinates
    const rect = renderer.domElement.getBoundingClientRect();
    const x = (tempV.x * 0.5 + 0.5) * rect.width + rect.left;
    const y = (1 - (tempV.y * 0.5 + 0.5)) * rect.height + rect.top;

    setContextMenu({
      ...contextMenu,
      x: x + 10, // Small offset
      y: y - 10, // Small offset
    });
  };

  // Update wireframe helpers when element changes
  const updateWireframeHelpers = (nodeId: string | null) => {
    if (!nodeId) return;

    const obj = getObject(nodeId);
    if (!obj) return;

    // Show all helper children
    obj.traverse((child) => {
      if (
        child.userData.helperType === "edge" ||
        child.userData.helperType === "vertex"
      ) {
        child.visible = true;
      }
    });
  };

  // Clear current selection
  const clearSelection = () => {
    if (selectedObject) {
      const obj = getObject(selectedObject);
      if (obj) {
        obj.traverse((child) => {
          if (
            child.userData.helperType === "edge" ||
            child.userData.helperType === "vertex"
          ) {
            child.visible = false;
          }
        });
      }
    }

    // Detach transform controls
    if (transformControlsRef.current) {
      transformControlsRef.current.detach();
    }

    setSelectedObject(null);
    setContextMenu({ visible: false, x: 0, y: 0, nodeId: null });
  };

  // Mouse down handler for selection
  const handleMouseDown = (event: MouseEvent) => {
    // Skip handling if this is a gizmo interaction
    if (transformControlsRef.current?.dragging) return;
    if (!camera || !renderer || event.button !== 0) return;

    // Create raycaster for object selection
    const raycaster = new THREE.Raycaster();
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);

    // Get all objects for intersection test
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
          setSelectedObject(el.nodeId);

          // Update context menu
          const boundingBox = new THREE.Box3().setFromObject(obj);
          const topRightCorner = new THREE.Vector3(
            boundingBox.max.x,
            boundingBox.max.y,
            boundingBox.max.z
          );

          const tempV = topRightCorner.clone();
          tempV.project(camera);

          const rect = renderer.domElement.getBoundingClientRect();
          const x = (tempV.x * 0.5 + 0.5) * rect.width + rect.left;
          const y = (1 - (tempV.y * 0.5 + 0.5)) * rect.height + rect.top;

          setContextMenu({
            visible: true,
            x: x + 10,
            y: y - 10,
            nodeId: el.nodeId,
          });

          // Create wireframe helpers
          updateWireframeHelpers(el.nodeId);

          break;
        }
      }
    } else {
      // Clicked empty space, clear selection
      clearSelection();
    }
  };

  // With gizmo-based movement, these handlers are much simpler
  const handleMouseMove = (event: MouseEvent) => {
    // The TransformControls now handle movement
  };

  const handleMouseUp = () => {
    // The TransformControls now handle releasing
  };

  // Return state and handlers
  return [
    { selectedObject, contextMenu },
    {
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      updateContextMenuPosition,
      clearSelection,
    },
  ];
};

export default useMoveMode;
