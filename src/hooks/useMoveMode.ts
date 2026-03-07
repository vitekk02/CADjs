import { useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { useCadCore } from "../contexts/CoreContext";
import { useCadVisualizer } from "../contexts/VisualizerContext";
import { isDescendantOf, collectPickableMeshes } from "../scene-operations/mesh-operations";
import { BODY, SELECTION } from "../theme";

interface MoveModeState {
  selectedObject: string | null;
}

interface MoveModeActions {
  handleMouseDown: (event: MouseEvent) => void;
  handleMouseMove: (event: MouseEvent) => void;
  handleMouseUp: (event: MouseEvent) => void;
  clearSelection: () => void;
}

const useMoveMode = (): [MoveModeState, MoveModeActions] => {
  const { elements, getObject, updateElementPosition, updateElementRotation, pushUndo, removeElement } =
    useCadCore();

  const {
    camera,
    renderer,
    scene,
    controls: orbitControls,
    forceSceneUpdate,
    showGroundPlane,
    navToolActiveRef,
    gridSpacing,
    gridSnapEnabled,
  } = useCadVisualizer();

  const showGroundPlaneRef = useRef(showGroundPlane);
  const gridSpacingRef = useRef(gridSpacing);
  const gridSnapEnabledRef = useRef(gridSnapEnabled);

  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const selectedObjectRef = useRef<string | null>(null);

  const [isRotating, setIsRotating] = useState<boolean>(false);

  const updateElementPositionRef = useRef(updateElementPosition);
  const updateElementRotationRef = useRef(updateElementRotation);
  const pushUndoRef = useRef(pushUndo);
  const removeElementRef = useRef(removeElement);
  const isRotatingRef = useRef(isRotating);

  useEffect(() => {
    selectedObjectRef.current = selectedObject;
  }, [selectedObject]);

  useEffect(() => {
    showGroundPlaneRef.current = showGroundPlane;
  }, [showGroundPlane]);

  useEffect(() => {
    gridSpacingRef.current = gridSpacing;
    gridSnapEnabledRef.current = gridSnapEnabled;
  }, [gridSpacing, gridSnapEnabled]);

  useEffect(() => {
    updateElementPositionRef.current = updateElementPosition;
    updateElementRotationRef.current = updateElementRotation;
    pushUndoRef.current = pushUndo;
    removeElementRef.current = removeElement;
  }, [updateElementPosition, updateElementRotation, pushUndo, removeElement]);

  useEffect(() => {
    isRotatingRef.current = isRotating;
  }, [isRotating]);

  const transformControlsRef = useRef<TransformControls | null>(null);
  const dragStartPositionRef = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    if (!scene || !camera || !renderer) {
      console.error("Scene, camera, or renderer not available");
      return;
    }


    const onDraggingChanged = (event) => {
      if (event.value) {
        pushUndoRef.current(isRotatingRef.current ? "Rotate" : "Move");
        // Capture position at drag start for relative delta snapping
        if (transformControlsRef.current?.object) {
          dragStartPositionRef.current = transformControlsRef.current.object.position.clone();
        }
      } else {
        dragStartPositionRef.current = null;
      }
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
          gridSnapEnabledRef.current &&
          transformControlsRef.current.mode === "translate" &&
          dragStartPositionRef.current
        ) {
          // Snap the movement delta to grid increments (not the absolute position).
          // This preserves relative alignment of objects at non-grid positions.
          const gridSize = gridSpacingRef.current;
          const startPos = dragStartPositionRef.current;
          const delta = position.clone().sub(startPos);
          delta.x = Math.round(delta.x / gridSize) * gridSize;
          delta.y = Math.round(delta.y / gridSize) * gridSize;
          const snappedPosition = startPos.clone().add(delta);

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

        if (isRotatingRef.current && transformControlsRef.current.object) {
          const obj = transformControlsRef.current.object;
          updateElementRotationRef.current(
            selectedObjectRef.current,
            obj.rotation.clone()
          );
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
      transformControls.setSpace("local");
      transformControls.setSize(1.25);
      transformControls.enabled = true;

      if (showGroundPlaneRef.current) {
        transformControls.setTranslationSnap(0.5);
        transformControls.setRotationSnap(Math.PI / 12);
      }

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
        if (transformControlsRef.current) {
          transformControlsRef.current.setTranslationSnap(null);
          transformControlsRef.current.setRotationSnap(null);
          forceSceneUpdate();
        }
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const nodeId = selectedObjectRef.current;
        if (nodeId) {
          if (transformControlsRef.current) {
            transformControlsRef.current.detach();
          }
          setSelectedObject(null);
          removeElementRef.current(nodeId);
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

  // Reset an object's material color back to default and hide helpers
  const resetObjectVisuals = (nodeId: string) => {
    const obj = getObject(nodeId);
    if (!obj) return;
    // Reset material color (skip edge overlays and helpers)
    obj.traverse((child) => {
      if (child.userData.isEdgeOverlay || child.userData.isHelper) return;
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material;
        if (mat && !Array.isArray(mat)) {
          (mat as THREE.MeshStandardMaterial).color.setHex(BODY.default);
        }
      }
    });
    // Hide helpers in a separate pass
    obj.traverse((child) => {
      if (
        child.userData.helperType === "edge" ||
        child.userData.helperType === "vertex"
      ) {
        child.visible = false;
      }
    });
  };

  // Apply selection color to an object
  const applySelectionColor = (nodeId: string) => {
    const obj = getObject(nodeId);
    if (!obj) return;
    obj.traverse((child) => {
      if (child.userData.isEdgeOverlay || child.userData.isHelper) return;
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material;
        if (mat && !Array.isArray(mat)) {
          (mat as THREE.MeshStandardMaterial).color.setHex(SELECTION.selected);
        }
      }
    });
  };

  // Clear current selection
  const clearSelection = () => {
    if (selectedObject) {
      resetObjectVisuals(selectedObject);
    }

    // Detach transform controls
    if (transformControlsRef.current) {
      transformControlsRef.current.detach();
    }

    setSelectedObject(null);
  };

  // Mouse down handler for selection
  const handleMouseDown = (event: MouseEvent) => {
    // Skip handling if this is a gizmo interaction
    if (transformControlsRef.current?.dragging) return;
    if (!camera || !renderer || event.button !== 0 || event.altKey || navToolActiveRef.current) return;

    // Create raycaster for object selection
    const raycaster = new THREE.Raycaster();
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);

    // Get only pickable Mesh children (skip edge overlays / helpers)
    const meshes = collectPickableMeshes(elements, getObject);
    const intersects = raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
      const pickedObject = intersects[0].object;

      // Find which element was clicked by walking up the parent chain
      for (const el of elements) {
        const obj = getObject(el.nodeId);
        if (obj && isDescendantOf(pickedObject, obj)) {
          // Reset old selection visuals if selecting a different element
          if (selectedObjectRef.current && selectedObjectRef.current !== el.nodeId) {
            resetObjectVisuals(selectedObjectRef.current);
          }

          setSelectedObject(el.nodeId);
          applySelectionColor(el.nodeId);
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
    { selectedObject },
    {
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      clearSelection,
    },
  ];
};

export default useMoveMode;
