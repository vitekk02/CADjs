// src/examples/SimpleCadScene.tsx
import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../src/contexts/CoreContext";
import { SceneElement, SceneMode } from "../src/scene-operations";
import { ShapeType, useCadVisualizer } from "../src/contexts/VisualizerContext";

interface SimpleCadSceneProps {
  initialMode?: SceneMode;
  initialShape?: ShapeType;
}

const SimpleCadScene: React.FC<SimpleCadSceneProps> = ({
  initialMode = "draw",
  initialShape = "rectangle",
}) => {
  // Refs
  const mountRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<THREE.Vector3 | null>(null);
  const selectedObjectRef = useRef<string | null>(null);
  const moveOffsetRef = useRef(new THREE.Vector3());
  const isDraggingRef = useRef(false);
  const previewMeshRef = useRef<THREE.Mesh | null>(null);
  const rotationControlRef = useRef<HTMLDivElement>(null);

  // Core context hooks
  const {
    selectElement,
    deselectElement,
    elements,
    getObject,
    mode,
    removeElement,
    selectedElements,
    setMode,
    unionSelectedElements,
    updateElementPosition,
    rotateElement,
  } = useCadCore();

  // Visualizer context hooks
  const {
    drawShape,
    forceSceneUpdate,
    getMouseIntersection,
    highlightElement,
    mountRenderer,
    renderer,
    camera,
    scene,
    setCurrentShape,
    unhighlightElement,
    unmountRenderer,
  } = useCadVisualizer();

  // Local state
  const [shape, setShape] = useState<ShapeType>(initialShape);
  const [showRotationControl, setShowRotationControl] = useState(false);
  const [rotationStartAngle, setRotationStartAngle] = useState(0);
  const [isRotating, setIsRotating] = useState(false);
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    nodeId: null as string | null,
  });

  // ===== HELPER FUNCTIONS =====

  // Show/hide wireframes on an element
  const toggleWireframes = (nodeId: string | null, show: boolean) => {
    if (!nodeId) return;

    const obj = getObject(nodeId);
    if (!obj) return;

    // Debug log to see what we're working with
    console.log("Toggling wireframes for", nodeId, "to", show);
    console.log("Object structure:", obj);

    // Find and toggle all wireframe children
    obj.traverse((child) => {
      // Check if this is a wireframe object using various detection methods
      if (
        (child.userData && child.userData.isWireframe) ||
        child instanceof THREE.LineSegments ||
        (child instanceof THREE.Group &&
          child.userData &&
          child.userData.isWireframe)
      ) {
        console.log("Found wireframe child:", child);
        child.visible = show;
      }
    });
  };

  // Position the context menu at the top-right corner of an element
  const positionContextMenu = (nodeId: string | null) => {
    if (!camera || !renderer || !nodeId) return;

    const obj = getObject(nodeId);
    if (!obj) return;

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
      x: x + 10, // Small offset
      y: y - 10, // Small offset
      nodeId,
    });
  };

  // Create and position rotation control
  const createRotationControl = (element: SceneElement) => {
    if (!camera || !renderer) return;

    const center = new THREE.Vector3().copy(element.position);
    const tempV = center.clone();
    tempV.project(camera);

    const rect = renderer.domElement.getBoundingClientRect();
    const centerX = (tempV.x * 0.5 + 0.5) * rect.width + rect.left;
    const centerY = (1 - (tempV.y * 0.5 + 0.5)) * rect.height + rect.top;

    setShowRotationControl(true);

    if (rotationControlRef.current) {
      rotationControlRef.current.style.left = `${centerX}px`;
      rotationControlRef.current.style.top = `${centerY}px`;
    }
  };

  // ===== ROTATION HANDLERS =====

  const handleRotationStart = (e: React.MouseEvent) => {
    if (!camera || !renderer || !selectedObjectRef.current) return;

    e.stopPropagation();

    const element = elements.find(
      (el) => el.nodeId === selectedObjectRef.current
    );
    if (!element) return;

    // Get screen coordinates of element center
    const center = new THREE.Vector3().copy(element.position);
    const tempV = center.clone();
    tempV.project(camera);

    const rect = renderer.domElement.getBoundingClientRect();
    const centerX = (tempV.x * 0.5 + 0.5) * rect.width + rect.left;
    const centerY = (1 - (tempV.y * 0.5 + 0.5)) * rect.height + rect.top;

    // Calculate initial angle
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);

    setRotationStartAngle(startAngle);
    setIsRotating(true);
  };

  const handleRotationMove = (e: MouseEvent) => {
    if (!isRotating || !selectedObjectRef.current) return;

    const element = elements.find(
      (el) => el.nodeId === selectedObjectRef.current
    );
    if (!element) return;

    // Store original position
    const originalPosition = element.position.clone();

    // Get screen coordinates of element center
    const center = new THREE.Vector3().copy(element.position);
    const tempV = center.clone();
    tempV.project(camera);

    const rect = renderer.domElement.getBoundingClientRect();
    const centerX = (tempV.x * 0.5 + 0.5) * rect.width + rect.left;
    const centerY = (1 - (tempV.y * 0.5 + 0.5)) * rect.height + rect.top;

    // Calculate new angle
    const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
    const angleDiff = -(currentAngle - rotationStartAngle);

    // Apply rotation
    rotateElement(selectedObjectRef.current, angleDiff);

    // Reset position to avoid any drift
    updateElementPosition(selectedObjectRef.current, originalPosition);

    // Update context menu position
    if (contextMenu.visible) {
      positionContextMenu(selectedObjectRef.current);
    }

    // Update for next frame
    setRotationStartAngle(currentAngle);
  };

  const handleRotationEnd = () => {
    setIsRotating(false);
  };

  // ===== EVENT HANDLERS =====

  // Drawing handler
  const handleDrawMode = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const point = getMouseIntersection(event);
    if (!point) return;

    if (event.type === "mousedown") {
      isDrawingRef.current = true;
      startPointRef.current = point.clone();
    } else if (
      event.type === "mousemove" &&
      isDrawingRef.current &&
      startPointRef.current
    ) {
      // Clear existing preview
      if (previewMeshRef.current && scene) {
        scene.remove(previewMeshRef.current);
        previewMeshRef.current = null;
      }

      // Create preview based on shape
      const material = new THREE.MeshBasicMaterial({
        color: 0x0088ff,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      });

      const start = startPointRef.current;
      let previewMesh: THREE.Mesh | undefined;

      switch (shape) {
        case "rectangle":
          const width = point.x - start.x;
          const height = point.y - start.y;
          const rectGeometry = new THREE.PlaneGeometry(
            Math.abs(width),
            Math.abs(height)
          );
          previewMesh = new THREE.Mesh(rectGeometry, material);
          previewMesh.position.set(
            start.x + width / 2,
            start.y + height / 2,
            0
          );
          break;

        case "triangle":
          const direction = new THREE.Vector3().subVectors(point, start);
          const perpendicular = new THREE.Vector3(
            -direction.y,
            direction.x,
            0
          ).normalize();
          const height2 = direction.length() * 0.866; // For equilateral
          const thirdPoint = new THREE.Vector3().addVectors(
            start,
            new THREE.Vector3().addVectors(
              new THREE.Vector3().copy(direction).multiplyScalar(0.5),
              new THREE.Vector3().copy(perpendicular).multiplyScalar(height2)
            )
          );

          const triangleGeometry = new THREE.BufferGeometry();
          triangleGeometry.setFromPoints([
            new THREE.Vector3(start.x, start.y, start.z),
            new THREE.Vector3(point.x, point.y, point.z),
            new THREE.Vector3(thirdPoint.x, thirdPoint.y, thirdPoint.z),
          ]);
          triangleGeometry.setIndex([0, 1, 2]);
          triangleGeometry.computeVertexNormals();

          previewMesh = new THREE.Mesh(triangleGeometry, material);
          break;

        case "circle":
          const radius = new THREE.Vector3().subVectors(point, start).length();
          const circleGeometry = new THREE.CircleGeometry(radius, 32);
          previewMesh = new THREE.Mesh(circleGeometry, material);
          previewMesh.position.copy(start);
          break;
      }

      if (scene && previewMesh) {
        scene.add(previewMesh);
        previewMeshRef.current = previewMesh;
      }
    } else if (
      event.type === "mouseup" &&
      isDrawingRef.current &&
      startPointRef.current
    ) {
      // Clean up preview
      if (previewMeshRef.current && scene) {
        scene.remove(previewMeshRef.current);
        previewMeshRef.current = null;
      }

      // Complete drawing
      drawShape(startPointRef.current, point);

      // Reset state
      isDrawingRef.current = false;
      startPointRef.current = null;
    }
  };

  // Move/selection handler
  const handleMoveMode = (event: MouseEvent) => {
    if (event.type === "mousedown" && event.button === 0) {
      // Handle selection
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      const objects: THREE.Object3D[] = [];
      elements.forEach((el) => {
        const obj = getObject(el.nodeId);
        if (obj) objects.push(obj);
      });

      const intersects = raycaster.intersectObjects(objects, true);

      if (intersects.length > 0) {
        const pickedObject = intersects[0].object;

        // Find associated element
        for (const el of elements) {
          const obj = getObject(el.nodeId);
          if (
            obj === pickedObject ||
            (pickedObject.parent && obj === pickedObject.parent)
          ) {
            // Select element
            selectedObjectRef.current = el.nodeId;

            // Show wireframes
            toggleWireframes(el.nodeId, true);

            // Show context menu
            positionContextMenu(el.nodeId);

            // Set up for movement
            const intersection = getMouseIntersection(event);
            if (intersection) {
              moveOffsetRef.current.copy(el.position).sub(intersection);
            }

            break;
          }
        }
      } else {
        // Clicked empty space, deselect
        if (selectedObjectRef.current) {
          toggleWireframes(selectedObjectRef.current, false);
        }
        selectedObjectRef.current = null;
        setContextMenu({ ...contextMenu, visible: false });
      }
    } else if (event.type === "mousemove" && selectedObjectRef.current) {
      // Handle movement
      if (isDraggingRef.current || event.buttons & 1) {
        isDraggingRef.current = true;

        const intersection = getMouseIntersection(event);
        if (intersection) {
          const newPosition = intersection.clone().add(moveOffsetRef.current);

          // Move element
          updateElementPosition(selectedObjectRef.current, newPosition);

          // Update UI elements
          if (contextMenu.visible) {
            positionContextMenu(selectedObjectRef.current);
          }

          if (showRotationControl) {
            const element = elements.find(
              (el) => el.nodeId === selectedObjectRef.current
            );
            if (element) {
              createRotationControl(element);
            }
          }
        }
      }
    } else if (event.type === "mouseup") {
      isDraggingRef.current = false;
    }
  };

  // Union handler
  const handleUnionMode = (event: MouseEvent) => {
    if (event.type !== "mousedown" || event.button !== 0) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const objects: THREE.Object3D[] = [];
    elements.forEach((el) => {
      const obj = getObject(el.nodeId);
      if (obj) objects.push(obj);
    });

    const intersects = raycaster.intersectObjects(objects, true);

    if (intersects.length > 0) {
      const pickedObject = intersects[0].object;

      // Find element
      for (const el of elements) {
        const obj = getObject(el.nodeId);
        if (
          obj === pickedObject ||
          (pickedObject.parent && obj === pickedObject.parent)
        ) {
          // Toggle selection
          if (selectedElements.includes(el.nodeId)) {
            deselectElement(el.nodeId);
            unhighlightElement(el.nodeId);
          } else {
            selectElement(el.nodeId);
            highlightElement(el.nodeId);
          }
          break;
        }
      }
    }
  };

  // ===== EFFECTS =====

  // Mount/unmount renderer
  useEffect(() => {
    if (!mountRef.current) return;

    if (renderer) {
      unmountRenderer();
    }

    const cleanup = mountRenderer(mountRef.current);
    return cleanup;
  }, []);

  // Shape change
  useEffect(() => {
    setCurrentShape(shape);
  }, [shape]);

  // Mode change cleanup
  useEffect(() => {
    // Hide wireframes for previously selected object
    if (selectedObjectRef.current) {
      toggleWireframes(selectedObjectRef.current, false);
    }

    setContextMenu({ visible: false, x: 0, y: 0, nodeId: null });
    setShowRotationControl(false);
    selectedObjectRef.current = null;
  }, [mode]);

  // Show rotation control when element selected
  useEffect(() => {
    if (mode === "move" && selectedObjectRef.current) {
      const element = elements.find(
        (el) => el.nodeId === selectedObjectRef.current
      );
      if (element) {
        createRotationControl(element);
      }
    } else {
      setShowRotationControl(false);
    }
  }, [mode, selectedObjectRef.current, elements]);

  // Rotation event listeners
  useEffect(() => {
    if (mode !== "move" || !isRotating) return;

    window.addEventListener("mousemove", handleRotationMove);
    window.addEventListener("mouseup", handleRotationEnd);

    return () => {
      window.removeEventListener("mousemove", handleRotationMove);
      window.removeEventListener("mouseup", handleRotationEnd);
    };
  }, [mode, isRotating, rotationStartAngle, selectedObjectRef.current]);

  // Mode-specific event handlers
  useEffect(() => {
    if (!renderer || !camera || !scene) return;

    // Attach event listeners based on mode
    if (mode === "draw") {
      renderer.domElement.addEventListener("mousedown", handleDrawMode);
      renderer.domElement.addEventListener("mousemove", handleDrawMode);
      renderer.domElement.addEventListener("mouseup", handleDrawMode);
    } else if (mode === "move") {
      renderer.domElement.addEventListener("mousedown", handleMoveMode);
      renderer.domElement.addEventListener("mousemove", handleMoveMode);
      renderer.domElement.addEventListener("mouseup", handleMoveMode);
    } else if (mode === "union") {
      renderer.domElement.addEventListener("mousedown", handleUnionMode);
    }

    // Cleanup
    return () => {
      renderer.domElement.removeEventListener("mousedown", handleDrawMode);
      renderer.domElement.removeEventListener("mousemove", handleDrawMode);
      renderer.domElement.removeEventListener("mouseup", handleDrawMode);
      renderer.domElement.removeEventListener("mousedown", handleMoveMode);
      renderer.domElement.removeEventListener("mousemove", handleMoveMode);
      renderer.domElement.removeEventListener("mouseup", handleMoveMode);
      renderer.domElement.removeEventListener("mousedown", handleUnionMode);
    };
  }, [
    mode,
    camera,
    scene,
    renderer,
    elements,
    selectedElements,
    shape,
    showRotationControl,
    contextMenu.visible,
  ]);

  // ===== RENDER =====

  return (
    <div className="relative w-full h-screen">
      {/* Canvas container */}
      <div ref={mountRef} className="absolute inset-0"></div>

      {/* Tool panel */}
      <div className="absolute top-0 left-0 p-4 z-10 bg-gray-800 bg-opacity-75 rounded-br-lg text-white">
        <div className="flex flex-col gap-2">
          <h2 className="font-bold">Mode:</h2>
          <div className="space-x-2">
            <button
              className={`px-3 py-1 rounded ${mode === "draw" ? "bg-blue-600" : "bg-gray-600"}`}
              onClick={() => setMode("draw")}
            >
              Draw
            </button>
            <button
              className={`px-3 py-1 rounded ${mode === "move" ? "bg-blue-600" : "bg-gray-600"}`}
              onClick={() => setMode("move")}
            >
              Move
            </button>
            <button
              className={`px-3 py-1 rounded ${mode === "union" ? "bg-blue-600" : "bg-gray-600"}`}
              onClick={() => setMode("union")}
            >
              Union
            </button>
          </div>

          {mode === "draw" && (
            <>
              <h2 className="font-bold mt-2">Shape:</h2>
              <div className="space-x-2">
                <button
                  className={`px-3 py-1 rounded ${shape === "rectangle" ? "bg-blue-600" : "bg-gray-600"}`}
                  onClick={() => setShape("rectangle")}
                >
                  Rectangle
                </button>
                <button
                  className={`px-3 py-1 rounded ${shape === "triangle" ? "bg-blue-600" : "bg-gray-600"}`}
                  onClick={() => setShape("triangle")}
                >
                  Triangle
                </button>
                <button
                  className={`px-3 py-1 rounded ${shape === "circle" ? "bg-blue-600" : "bg-gray-600"}`}
                  onClick={() => setShape("circle")}
                >
                  Circle
                </button>
              </div>
            </>
          )}

          {mode === "union" && selectedElements.length >= 2 && (
            <button
              className="px-4 py-2 bg-green-600 rounded mt-2"
              onClick={() => {
                unionSelectedElements();
                forceSceneUpdate();
              }}
            >
              Union Selected ({selectedElements.length})
            </button>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu.visible && (
        <div
          className="absolute z-20 bg-gray-900 bg-opacity-90 rounded shadow-lg p-2 min-w-[120px] text-white"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
        >
          <div className="flex flex-col gap-1">
            <button
              className="px-3 py-1 text-left hover:bg-gray-700 rounded"
              onClick={() => {
                if (contextMenu.nodeId) {
                  console.log("Copy", contextMenu.nodeId);
                }
              }}
            >
              Copy
            </button>
            <button
              className="px-3 py-1 text-left hover:bg-gray-700 rounded"
              onClick={() => {
                if (contextMenu.nodeId) {
                  removeElement(contextMenu.nodeId);
                  setContextMenu({ ...contextMenu, visible: false });
                  selectedObjectRef.current = null;
                  setShowRotationControl(false);
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Rotation control */}
      {showRotationControl && mode === "move" && (
        <div
          ref={rotationControlRef}
          className="absolute z-30 w-[100px] h-[100px] transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        >
          {/* Rotation ring */}
          <div className="absolute inset-0 border-2 border-yellow-500 rounded-full opacity-70 pointer-events-none" />
          {/* Rotation handle */}
          <div
            className="absolute w-6 h-6 bg-yellow-500 rounded-full -top-3 left-1/2 transform -translate-x-1/2 cursor-grab hover:bg-yellow-400 pointer-events-auto"
            onMouseDown={handleRotationStart}
          >
            <div className="absolute left-1/2 top-3 w-px h-5 bg-yellow-500" />
          </div>
        </div>
      )}

      {/* Element info panel */}
      {selectedObjectRef.current && (
        <div className="absolute bottom-0 right-0 p-4 bg-gray-800 bg-opacity-75 rounded-tl-lg text-white">
          <h3 className="font-bold">Element Info</h3>
          <p>ID: {selectedObjectRef.current}</p>
          {elements.find((el) => el.nodeId === selectedObjectRef.current) && (
            <>
              <p>
                Position:{" "}
                {`X: ${elements
                  .find((el) => el.nodeId === selectedObjectRef.current)
                  ?.position.x.toFixed(2)}, 
                 Y: ${elements
                   .find((el) => el.nodeId === selectedObjectRef.current)
                   ?.position.y.toFixed(2)}, 
                 Z: ${elements
                   .find((el) => el.nodeId === selectedObjectRef.current)
                   ?.position.z.toFixed(2)}`}
              </p>
              <p>
                Vertices:{" "}
                {elements.find((el) => el.nodeId === selectedObjectRef.current)
                  ?.brep.vertices?.length || 0}
              </p>
              <p>
                Edges:{" "}
                {elements.find((el) => el.nodeId === selectedObjectRef.current)
                  ?.brep.edges?.length || 0}
              </p>
              <p>
                Faces:{" "}
                {elements.find((el) => el.nodeId === selectedObjectRef.current)
                  ?.brep.faces?.length || 0}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SimpleCadScene;
