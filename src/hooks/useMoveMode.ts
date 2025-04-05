import { useRef, useState, useEffect, useCallback } from "react";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { SceneElement } from "../scene-operations/types";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";

interface MoveModeState {
  selectedObject: string | null;
  contextMenu: {
    visible: boolean;
    x: number;
    y: number;
    nodeId: string | null;
  };
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
  // Get required context
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

  // State for selected object and context menu
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

  // Add this function to snap rotations to increments
  const snapRotationToIncrement = useCallback(
    (rotation: THREE.Euler): THREE.Euler => {
      if (showGroundPlane && !shiftKeyPressed) {
        // Snap to 15-degree increments (in radians)
        const angleIncrement = Math.PI / 12; // 15 degrees
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

  // Ref for transform controls (gizmo)
  const transformControlsRef = useRef<TransformControls | null>(null);

  // Initialize transform controls when scene is available
  // Initialize transform controls when scene is available
  useEffect(() => {
    if (!scene || !camera || !renderer) {
      console.error("Scene, camera, or renderer not available");
      return;
    }

    console.log("Scene, camera, and renderer are available");

    // Store event listeners for cleanup
    const onDraggingChanged = (event) => {
      if (orbitControls) {
        orbitControls.enabled = !event.value;
      }
    };

    const onObjectChange = () => {
      console.log("Object changed in transform controls");
      if (selectedObjectRef.current && transformControlsRef.current?.object) {
        // Get the current position
        const position = new THREE.Vector3();
        transformControlsRef.current.object.getWorldPosition(position);

        // Apply grid snapping to position if enabled
        if (
          showGroundPlaneRef.current &&
          transformControlsRef.current.mode === "translate"
        ) {
          const snappedPosition = snapPositionToGrid(position);

          // Only update if actually changed (prevents loops)
          if (!position.equals(snappedPosition)) {
            transformControlsRef.current.object.position.copy(snappedPosition);
          }

          // Update position in the data model
          updateElementPositionRef.current(
            selectedObjectRef.current,
            snappedPosition
          );
        } else {
          // Normal update without snapping
          updateElementPositionRef.current(selectedObjectRef.current, position);
        }

        // Handle rotation if we're in rotation mode
        if (isRotating && transformControlsRef.current.object) {
          const rotation = new THREE.Euler();
          rotation.setFromRotationMatrix(
            new THREE.Matrix4().extractRotation(
              transformControlsRef.current.object.matrixWorld
            )
          );

          // Apply rotation snapping if enabled
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

    // Thorough cleanup of existing controls
    if (transformControlsRef.current) {
      // Remove event listeners
      transformControlsRef.current.removeEventListener(
        "dragging-changed",
        onDraggingChanged
      );
      transformControlsRef.current.removeEventListener(
        "objectChange",
        onObjectChange
      );

      // Detach from any object
      transformControlsRef.current.detach();

      // Make sure it's removed from the scene (need to get helper for removal)
      try {
        const gizmo = transformControlsRef.current.getHelper();
        if (scene && gizmo) {
          console.log("Removing previous transform control gizmo");
          scene.remove(gizmo);
        }
      } catch (e) {
        console.error("Error removing transform controls:", e);
      }

      // Dispose and nullify
      transformControlsRef.current.dispose();
      transformControlsRef.current = null;
    }

    // Create fresh transform controls
    try {
      const transformControls = new TransformControls(
        camera,
        renderer.domElement
      );

      // Basic setup
      transformControls.setMode("translate");
      transformControls.setSpace("world");
      transformControls.setSize(1.25);
      transformControls.enabled = true;

      // Add event listeners
      transformControls.addEventListener("dragging-changed", onDraggingChanged);
      transformControls.addEventListener("objectChange", onObjectChange);

      // Add to scene
      const gizmo = transformControls.getHelper();
      gizmo.userData.helperType = "gizmo";
      scene.add(gizmo);

      // Store reference
      transformControlsRef.current = transformControls;
      console.log("Transform controls created and added to scene");

      // Force update to see the controls
      forceSceneUpdate();
    } catch (error) {
      console.error("Error creating transform controls:", error);
    }

    // Clean up on unmount or when effect re-runs
    return () => {
      if (transformControlsRef.current) {
        // Remove event listeners
        transformControlsRef.current.removeEventListener(
          "dragging-changed",
          onDraggingChanged
        );
        transformControlsRef.current.removeEventListener(
          "objectChange",
          onObjectChange
        );

        // Detach from any object
        transformControlsRef.current.detach();

        // Remove gizmo from scene
        try {
          const gizmo = transformControlsRef.current.getHelper();
          if (scene && gizmo) {
            scene.remove(gizmo);
          }
        } catch (e) {
          console.error("Error cleaning up transform controls:", e);
        }

        // Dispose and nullify
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
        console.log("Shift key down");
        setShiftKeyPressed(true);
        // Directly update transform controls
        if (transformControlsRef.current) {
          transformControlsRef.current.setTranslationSnap(null);
          transformControlsRef.current.setRotationSnap(null);
          console.log("Snapping disabled directly from keydown handler");
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
        console.log("Shift key up");
        setShiftKeyPressed(false);
        // Directly update transform controls
        if (transformControlsRef.current && showGroundPlane) {
          transformControlsRef.current.setTranslationSnap(0.5);
          transformControlsRef.current.setRotationSnap(Math.PI / 12);
          console.log("Snapping re-enabled directly from keyup handler");
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
  // Attach/detach transform controls when selected object changes
  useEffect(() => {
    const transformControls = transformControlsRef.current;
    if (!transformControls) {
      console.log("No transform controls available for attaching object");
      return;
    }
    if (!scene) {
      console.log("No scene available for attaching object");
      return;
    }

    try {
      if (selectedObject) {
        const obj = getObject(selectedObject);
        console.log("Object to attach:", obj, "for nodeId:", selectedObject);

        if (!obj) {
          console.error("Object not found for ID:", selectedObject);
          return;
        }

        if (!(obj instanceof THREE.Object3D)) {
          console.error("Object is not an instance of THREE.Object3D:", obj);
          return;
        }

        console.log("Attaching object to transform controls:", obj);
        transformControls.attach(obj);
        console.log(transformControls);
        console.log(scene.children);
        transformControls.visible = true;
        forceSceneUpdate();
        console.log(
          "Object attached successfully, controls visible:",
          transformControls.visible
        );
      } else {
        transformControls.detach();
        console.log("Transform controls detached (no selection)");
      }
    } catch (error) {
      console.error("Error attaching object to TransformControls:", error);
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
