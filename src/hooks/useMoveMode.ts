// src/hooks/useMoveMode.ts
import { useRef, useState } from "react";
import * as THREE from "three";
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

  // Refs for tracking move operations
  const moveOffsetRef = useRef(new THREE.Vector3());
  const isDraggingRef = useRef(false);
  const edgeHelpersRef = useRef<THREE.LineSegments | null>(null);
  const vertexHelpersRef = useRef<THREE.Object3D | null>(null);

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

    setSelectedObject(null);
    setContextMenu({ visible: false, x: 0, y: 0, nodeId: null });
  };

  // Mouse down handler for selection
  const handleMouseDown = (event: MouseEvent) => {
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

          // Set up for movement
          const intersection = getMouseIntersection(event);
          if (intersection) {
            moveOffsetRef.current.copy(el.position).sub(intersection);
          }

          break;
        }
      }
    } else {
      // Clicked empty space, clear selection
      clearSelection();
    }

    isDraggingRef.current = false;
  };

  // Mouse move handler for dragging
  const handleMouseMove = (event: MouseEvent) => {
    if (!selectedObject) return;

    if (isDraggingRef.current || event.buttons & 1) {
      isDraggingRef.current = true;

      const intersection = getMouseIntersection(event);
      if (intersection) {
        const newPosition = intersection.clone().add(moveOffsetRef.current);

        // Move the element
        updateElementPosition(selectedObject, newPosition);

        // Find updated element
        const updatedElement = elements.find(
          (el) => el.nodeId === selectedObject
        );

        // Update helper positions
        if (updatedElement && scene) {
          if (edgeHelpersRef.current) {
            edgeHelpersRef.current.position.copy(updatedElement.position);
          }

          if (vertexHelpersRef.current) {
            vertexHelpersRef.current.position.copy(updatedElement.position);
          }
        }

        // Update context menu position
        if (contextMenu.visible && contextMenu.nodeId === selectedObject) {
          updateContextMenuPosition(selectedObject);
        }
      }
    }
  };

  // Mouse up handler
  const handleMouseUp = () => {
    isDraggingRef.current = false;
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
