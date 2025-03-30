// src/examples/SimpleCadScene.tsx
import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../src/contexts/CoreContext";
import { SceneMode } from "../src/scene-operations";
import { ShapeType, useCadVisualizer } from "../src/contexts/VisualizerContext";

interface SimpleCadSceneProps {
  initialMode?: SceneMode;
  initialShape?: ShapeType;
}

const SimpleCadScene: React.FC<SimpleCadSceneProps> = ({
  initialMode = "draw",
  initialShape = "rectangle",
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
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
  } = useCadCore();
  const {
    createEdgeHelpers,
    createVertexHelpers,
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

  // Local state for UI components
  const [shape, setShape] = useState<ShapeType>(initialShape);

  // References for event handling
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<THREE.Vector3 | null>(null);
  const selectedObjectRef = useRef<string | null>(null);
  const moveOffsetRef = useRef(new THREE.Vector3());
  const isDraggingRef = useRef(false);

  // Edge and vertex visualization
  const [edgeHelpers, setEdgeHelpers] = useState<THREE.LineSegments | null>(
    null
  );
  const [vertexHelpers, setVertexHelpers] = useState<THREE.Points | null>(null);

  // Context menu state
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

  // Mount the renderer when component mounts
  useEffect(() => {
    if (!mountRef.current) return;

    // Clean up previous renderer if any
    if (renderer) {
      unmountRenderer();
    }

    // Mount the renderer to the DOM
    const cleanup = mountRenderer(mountRef.current);

    // Return cleanup function
    return cleanup;
  }, []);

  // Update core mode when local mode changes
  useEffect(() => {
    // Clean up any active visualizations
    if (edgeHelpers && scene) {
      scene.remove(edgeHelpers);
      setEdgeHelpers(null);
    }
    if (vertexHelpers && scene) {
      scene.remove(vertexHelpers);
      setVertexHelpers(null);
    }
    setContextMenu({ visible: false, x: 0, y: 0, nodeId: null });
  }, [scene, edgeHelpers, vertexHelpers]);

  // Update visualizer shape when local shape changes
  useEffect(() => {
    setCurrentShape(shape);
  }, [shape]);

  // Set up event handlers based on current mode
  useEffect(() => {
    if (!renderer || !camera || !scene) return;

    const handleDrawMode = (event: MouseEvent) => {
      if (event.button !== 0) return; // Left mouse button only
      const point = getMouseIntersection(event);
      if (!point) return;

      if (event.type === "mousedown") {
        isDrawingRef.current = true;
        startPointRef.current = point.clone();
      } else if (event.type === "mouseup") {
        if (!isDrawingRef.current || !startPointRef.current) return;

        // Complete the drawing operation
        drawShape(startPointRef.current, point);

        // Reset state
        isDrawingRef.current = false;
        startPointRef.current = null;
      }
    };

    const handleMoveMode = (event: MouseEvent) => {
      const raycaster = new THREE.Raycaster();

      if (event.type === "mousedown" && event.button === 0) {
        // Only process if nothing is currently selected or we're clicking on a new object
        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);

        // Create array of objects for intersection test
        const objects: THREE.Object3D[] = [];
        elements.forEach((el) => {
          const obj = getObject(el.nodeId);
          if (obj) objects.push(obj);
        });

        const intersects = raycaster.intersectObjects(objects, true);

        // Handle object selection
        if (intersects.length > 0) {
          const pickedObject = intersects[0].object;

          // Find the element this object belongs to
          for (const el of elements) {
            const obj = getObject(el.nodeId);
            if (
              obj === pickedObject ||
              (pickedObject.parent && obj === pickedObject.parent)
            ) {
              selectedObjectRef.current = el.nodeId;

              // Create visualization helpers
              if (scene) {
                // Remove previous helpers
                if (edgeHelpers) scene.remove(edgeHelpers);
                if (vertexHelpers) scene.remove(vertexHelpers);

                // Create new helpers
                const newEdgeHelpers = createEdgeHelpers(el);
                const newVertexHelpers = createVertexHelpers(el);

                if (newEdgeHelpers) {
                  scene.add(newEdgeHelpers);
                  setEdgeHelpers(newEdgeHelpers);
                }

                if (newVertexHelpers) {
                  scene.add(newVertexHelpers);
                  setVertexHelpers(newVertexHelpers);
                }
              }

              // Set up for movement
              const intersection = getMouseIntersection(event);
              if (intersection) {
                moveOffsetRef.current.copy(el.position).sub(intersection);
              }

              // Show context menu
              setContextMenu({
                visible: true,
                x: event.clientX,
                y: event.clientY,
                nodeId: el.nodeId,
              });

              break;
            }
          }
        } else {
          // Clicked empty space, clear selection
          selectedObjectRef.current = null;
          if (scene) {
            if (edgeHelpers) scene.remove(edgeHelpers);
            if (vertexHelpers) scene.remove(vertexHelpers);
          }
          setEdgeHelpers(null);
          setVertexHelpers(null);
          setContextMenu({ visible: false, x: 0, y: 0, nodeId: null });
        }
      }
      // Handle dragging for movement
      else if (event.type === "mousemove" && selectedObjectRef.current) {
        if (isDraggingRef.current || event.buttons & 1) {
          // Left button is pressed
          isDraggingRef.current = true;

          const intersection = getMouseIntersection(event);
          if (intersection) {
            const newPosition = intersection.clone().add(moveOffsetRef.current);

            // Move the element
            updateElementPosition(selectedObjectRef.current, newPosition);

            // Update helper visualizations
            if (edgeHelpers) edgeHelpers.position.copy(newPosition);
            if (vertexHelpers) vertexHelpers.position.copy(newPosition);

            // Move context menu with object
            if (
              contextMenu.visible &&
              contextMenu.nodeId === selectedObjectRef.current
            ) {
              // Project 3D position to screen
              const screenPos = new THREE.Vector3(
                newPosition.x,
                newPosition.y,
                newPosition.z
              );
              screenPos.project(camera);

              const rect = renderer.domElement.getBoundingClientRect();
              const x = (screenPos.x * 0.5 + 0.5) * rect.width + rect.left;
              const y =
                (1 - (screenPos.y * 0.5 + 0.5)) * rect.height + rect.top;

              setContextMenu({
                ...contextMenu,
                x,
                y,
              });
            }
          }
        }
      } else if (event.type === "mouseup") {
        isDraggingRef.current = false;
      }
    };

    const handleUnionMode = (event: MouseEvent) => {
      if (event.type !== "mousedown" || event.button !== 0) return;

      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      // Create array of objects for intersection test
      const objects: THREE.Object3D[] = [];
      elements.forEach((el) => {
        const obj = getObject(el.nodeId);
        if (obj) objects.push(obj);
      });

      const intersects = raycaster.intersectObjects(objects, true);

      if (intersects.length > 0) {
        const pickedObject = intersects[0].object;

        // Find the element this object belongs to
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

    // Attach event listeners based on current mode
    if (mode === "draw") {
      renderer.domElement.addEventListener("mousedown", handleDrawMode);
      renderer.domElement.addEventListener("mouseup", handleDrawMode);
    } else if (mode === "move") {
      renderer.domElement.addEventListener("mousedown", handleMoveMode);
      renderer.domElement.addEventListener("mousemove", handleMoveMode);
      renderer.domElement.addEventListener("mouseup", handleMoveMode);
    } else if (mode === "union") {
      renderer.domElement.addEventListener("mousedown", handleUnionMode);
    }

    // Clean up event listeners
    return () => {
      renderer.domElement.removeEventListener("mousedown", handleDrawMode);
      renderer.domElement.removeEventListener("mouseup", handleDrawMode);
      renderer.domElement.removeEventListener("mousedown", handleMoveMode);
      renderer.domElement.removeEventListener("mousemove", handleMoveMode);
      renderer.domElement.removeEventListener("mouseup", handleMoveMode);
      renderer.domElement.removeEventListener("mousedown", handleUnionMode);
    };
  }, [
    mode,
    edgeHelpers,
    vertexHelpers,
    camera,
    scene,
    elements,
    selectedElements,
  ]);

  // Render simple UI controls alongside the canvas
  return (
    <div className="relative w-full h-screen">
      {/* Main canvas container */}
      <div ref={mountRef} className="absolute inset-0"></div>

      {/* Simple mode selector toolbar */}
      <div className="absolute top-0 left-0 p-4 z-10 bg-gray-800 bg-opacity-75 rounded-br-lg text-white">
        <div className="flex flex-col gap-2">
          <h2 className="font-bold">Mode:</h2>
          <div className="space-x-2">
            <button
              className={`px-3 py-1 rounded ${
                mode === "draw" ? "bg-blue-600" : "bg-gray-600"
              }`}
              onClick={() => setMode("draw")}
            >
              Draw
            </button>
            <button
              className={`px-3 py-1 rounded ${
                mode === "move" ? "bg-blue-600" : "bg-gray-600"
              }`}
              onClick={() => setMode("move")}
            >
              Move
            </button>
            <button
              className={`px-3 py-1 rounded ${
                mode === "union" ? "bg-blue-600" : "bg-gray-600"
              }`}
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
                  className={`px-3 py-1 rounded ${
                    shape === "rectangle" ? "bg-blue-600" : "bg-gray-600"
                  }`}
                  onClick={() => setShape("rectangle")}
                >
                  Rectangle
                </button>
                <button
                  className={`px-3 py-1 rounded ${
                    shape === "triangle" ? "bg-blue-600" : "bg-gray-600"
                  }`}
                  onClick={() => setShape("triangle")}
                >
                  Triangle
                </button>
                <button
                  className={`px-3 py-1 rounded ${
                    shape === "circle" ? "bg-blue-600" : "bg-gray-600"
                  }`}
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

      {/* Context menu for selected object */}
      {contextMenu.visible && (
        <div
          className="absolute z-20 bg-gray-900 bg-opacity-90 rounded shadow-lg p-2 min-w-[120px] text-white"
          style={{
            left: `${contextMenu.x + 10}px`,
            top: `${contextMenu.y - 10}px`,
            transform: "translate(0, -100%)",
          }}
        >
          <div className="flex flex-col gap-1">
            <button
              className="px-3 py-1 text-left hover:bg-gray-700 rounded"
              onClick={() => {
                if (contextMenu.nodeId) {
                  // Implement copy functionality here
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
                  // Clean up visualizations
                  if (edgeHelpers && scene) {
                    scene.remove(edgeHelpers);
                    setEdgeHelpers(null);
                  }
                  if (vertexHelpers && scene) {
                    scene.remove(vertexHelpers);
                    setVertexHelpers(null);
                  }

                  // Remove the element
                  removeElement(contextMenu.nodeId);
                  setContextMenu({ visible: false, x: 0, y: 0, nodeId: null });
                  selectedObjectRef.current = null;
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Element info panel - shows properties of selected element */}
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
