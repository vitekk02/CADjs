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
  const previewMeshRef = useRef<THREE.Mesh | null>(null);
  // Edge and vertex visualization
  const [edgeHelpers, setEdgeHelpers] = useState<THREE.LineSegments | null>(
    null
  );
  const [vertexHelpers, setVertexHelpers] = useState<THREE.Object3D | null>(
    null
  );
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
  }, [mode]);
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
      } else if (event.type === "mousemove") {
        // Only show preview when drawing
        if (!isDrawingRef.current || !startPointRef.current) return;

        // Remove any existing preview
        if (previewMeshRef.current && scene) {
          scene.remove(previewMeshRef.current);
          previewMeshRef.current = null;
        }

        const start = startPointRef.current;
        const material = new THREE.MeshBasicMaterial({
          color: 0x0088ff,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
        });

        let previewMesh: THREE.Mesh;

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
            const height2 = direction.length() * 0.866; // Height for equilateral triangle
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
            const radius = new THREE.Vector3()
              .subVectors(point, start)
              .length();
            const circleGeometry = new THREE.CircleGeometry(radius, 32);
            previewMesh = new THREE.Mesh(circleGeometry, material);
            previewMesh.position.copy(start);
            break;
        }

        if (scene && previewMesh) {
          scene.add(previewMesh);
          previewMeshRef.current = previewMesh;
        }
      } else if (event.type === "mouseup") {
        if (!isDrawingRef.current || !startPointRef.current) return;

        // Clean up preview
        if (previewMeshRef.current && scene) {
          scene.remove(previewMeshRef.current);
          previewMeshRef.current = null;
        }

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

              // Calculate the bounding box of the selected object
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

              // Make the context menu visible at the top-right corner position
              setContextMenu({
                visible: true,
                x: x + 10, // Small offset to ensure it's outside the box
                y: y - 10, // Small offset
                nodeId: el.nodeId,
              });

              // Create visualization helpers
              if (scene) {
                // Remove previous helpers
                if (edgeHelpers) scene.remove(edgeHelpers);
                if (vertexHelpers) scene.remove(vertexHelpers);

                // Create new helpers
                const newEdgeHelpers = createEdgeHelpers(el);
                const newVertexHelpers = createVertexHelpers(el);
                if (newEdgeHelpers) {
                  newEdgeHelpers.position.copy(el.position);
                  scene.add(newEdgeHelpers);
                  setEdgeHelpers(newEdgeHelpers);
                }

                if (newVertexHelpers) {
                  newVertexHelpers.position.copy(el.position);
                  scene.add(newVertexHelpers);
                  setVertexHelpers(newVertexHelpers);
                }
              }

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

            // Find the updated element
            const updatedElement = elements.find(
              (el) => el.nodeId === selectedObjectRef.current
            );

            // Update the helper positions directly without recreating them
            if (updatedElement && scene) {
              if (edgeHelpers) {
                // Don't set state during drag - just update position directly
                edgeHelpers.position.copy(updatedElement.position);
              }

              if (vertexHelpers) {
                // Don't set state during drag - just update position directly
                vertexHelpers.position.copy(updatedElement.position);
              }
            }

            // Move context menu with object - important: calculate position from the bounding box
            if (
              contextMenu.visible &&
              contextMenu.nodeId === selectedObjectRef.current
            ) {
              const obj = getObject(selectedObjectRef.current);
              if (obj) {
                // Recalculate the bounding box after movement
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
                  x: x + 10, // Small offset to ensure it's outside the box
                  y: y - 10, // Small offset
                });
              }
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
      renderer.domElement.addEventListener("mousemove", handleDrawMode);
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
      renderer.domElement.removeEventListener("mousemove", handleDrawMode);
    };
  }, [
    mode,
    edgeHelpers,
    vertexHelpers,
    camera,
    scene,
    elements,
    selectedElements,
    shape,
    drawShape,
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
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            // Remove the transform that was shifting it up by 100%
          }}
        >
          <div className="flex flex-col gap-1">
            <button
              className="px-3 py-1 text-left hover:bg-gray-700 rounded"
              onClick={() => {
                if (contextMenu.nodeId) {
                  // Copy functionality
                }
              }}
            >
              Copy
            </button>
            <button
              className="px-3 py-1 text-left hover:bg-gray-700 rounded"
              onClick={() => {
                // Existing delete functionality...
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
