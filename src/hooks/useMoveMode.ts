import { useRef, useState, useEffect } from "react";
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
  const { elements, getObject, updateElementPosition } = useCadCore();

  const {
    camera,
    renderer,
    scene,
    getMouseIntersection,
    createEdgeHelpers,
    createVertexHelpers,
    controls: orbitControls,
    forceSceneUpdate,
  } = useCadVisualizer();

  // State for selected object and context menu
  const [selectedObject, setSelectedObject] = useState<string | null>(null);
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

  // Ref for transform controls (gizmo)
  const transformControlsRef = useRef<TransformControls | null>(null);
  const edgeHelpersRef = useRef<THREE.LineSegments | null>(null);
  const vertexHelpersRef = useRef<THREE.Object3D | null>(null);
  console.log(transformControlsRef.current?.gizmo);
  // Initialize transform controls when scene is available
  useEffect(() => {
    if (!scene || !camera || !renderer) {
      console.error("Scene, camera, or renderer not available");
      return;
    }

    console.log("Scene, camera, and renderer are available");

    // Clean up any existing transform controls
    if (transformControlsRef.current) {
      try {
        scene.remove(transformControlsRef.current);
        transformControlsRef.current.dispose();
      } catch (e) {
        console.error("Error cleaning up transform controls:", e);
      }
      transformControlsRef.current = null;
    }

    try {
      // Create transform controls without instanceof check
      const transformControls = new TransformControls(
        camera,
        renderer.domElement
      );

      // Basic setup
      transformControls.setMode("translate");
      transformControls.setSize(1.25);

      // Make sure axes are visible
      transformControls.showX = true;
      transformControls.showY = true;
      transformControls.showZ = true;

      transformControls.enabled = true;

      // Event listeners
      transformControls.addEventListener("dragging-changed", (event) => {
        if (orbitControls) {
          orbitControls.enabled = !event.value;
        }
      });

      transformControls.addEventListener("objectChange", () => {
        if (selectedObject && transformControls.object) {
          const position = new THREE.Vector3();
          transformControls.object.getWorldPosition(position);
          updateElementPosition(selectedObject, position);

          if (contextMenu.visible && contextMenu.nodeId === selectedObject) {
            updateContextMenuPosition(selectedObject);
          }

          forceSceneUpdate();
        }
      });

      // Add to scene - use try/catch to capture any errors
      try {
        console.log("Adding TransformControls to scene");
        const gizmo = transformControls.getHelper();
        gizmo.userData.helperType = "gizmo";
        scene.add(gizmo);
        console.log("TransformControls added successfully");
      } catch (e) {
        console.error("Error adding TransformControls to scene:", e);
        return;
      }

      transformControlsRef.current = transformControls;

      // Force scene update to make controls appear
      forceSceneUpdate();
    } catch (error) {
      console.error("Error in TransformControls creation:", error);
    }

    return () => {
      if (transformControlsRef.current) {
        try {
          transformControlsRef.current.dispose();
          scene.remove(transformControlsRef.current);
        } catch (e) {
          console.error("Error cleaning up transform controls:", e);
        }
        transformControlsRef.current = null;
      }
    };
  }, [scene, camera, renderer]);

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
