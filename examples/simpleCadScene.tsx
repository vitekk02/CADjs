// src/examples/SimpleCadScene.tsx
import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../src/contexts/CoreContext";
import { SceneMode } from "../src/scene-operations";
import { ShapeType, useCadVisualizer } from "../src/contexts/VisualizerContext";
import useMoveMode from "../src/hooks/useMoveMode";
import { useUnionMode } from "../src/hooks/useUnionMode";
import { useDrawMode } from "../src/hooks/useDrawMode";

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
    showGroundPlane,
    toggleGroundPlane,
  } = useCadVisualizer();

  // Local state for UI components
  const [shape, setShape] = useState<ShapeType>(initialShape);

  const [
    { selectedObject, contextMenu },
    {
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      updateContextMenuPosition,
      clearSelection,
    },
  ] = useMoveMode();
  const { handleUnionModeClick, performUnion, canUnion } = useUnionMode();

  const {
    handleDrawMode,
    previewMeshRef,
    isDrawingRef,
    startPointRef,
    cleanupPreview,
  } = useDrawMode();

  const selectedObjectRef = useRef<string | null>(null);
  useEffect(() => {
    selectedObjectRef.current = selectedObject;
  }, [selectedObject]);

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
    // Create a function to ensure all elements have visualization helpers
    const setupElementVisualizations = () => {
      elements.forEach((element) => {
        const obj = getObject(element.nodeId);
        if (!obj) return;

        // Skip if this object already has helpers
        if (obj.userData.hasHelpers) return;

        // Create helpers
        const edgeHelper = createEdgeHelpers(element);
        const vertexHelper = createVertexHelpers(element);

        // Add helpers to the object group
        if (edgeHelper) {
          edgeHelper.visible = false; // Initially hidden
          obj.add(edgeHelper);
        }

        if (vertexHelper) {
          vertexHelper.visible = false; // Initially hidden
          obj.add(vertexHelper);
        }

        // Mark this object as having helpers
        obj.userData.hasHelpers = true;
      });
    };

    // Call this whenever elements change
    if (scene) {
      setupElementVisualizations();
    }
  }, [elements, scene]);
  // Update visualizer shape when local shape changes
  useEffect(() => {
    setCurrentShape(shape);
  }, [shape]);

  // Set up event handlers based on current mode
  useEffect(() => {
    if (!renderer || !camera || !scene) return;

    const handleMoveMode = (event: MouseEvent) => {
      if (event.type === "mousedown") {
        handleMouseDown(event);
      } else if (event.type === "mousemove") {
        handleMouseMove(event);
      } else if (event.type === "mouseup") {
        handleMouseUp(event);
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
      renderer.domElement.addEventListener("mousedown", handleUnionModeClick);
    }

    // Clean up event listeners
    return () => {
      renderer.domElement.removeEventListener("mousedown", handleDrawMode);
      renderer.domElement.removeEventListener("mouseup", handleDrawMode);
      renderer.domElement.removeEventListener("mousedown", handleMoveMode);
      renderer.domElement.removeEventListener("mousemove", handleMoveMode);
      renderer.domElement.removeEventListener("mouseup", handleMoveMode);
      renderer.domElement.removeEventListener(
        "mousedown",
        handleUnionModeClick
      );
      renderer.domElement.removeEventListener("mousemove", handleDrawMode);
      cleanupPreview();
    };
  }, [
    mode,
    camera,
    scene,
    elements,
    selectedElements,
    shape,
    drawShape,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    updateContextMenuPosition,
    handleUnionModeClick,
    clearSelection,
    cleanupPreview,
    handleDrawMode,
  ]);

  // Render simple UI controls alongside the canvas
  return (
    <div className="relative w-full h-screen">
      {/* Main canvas container */}
      <div ref={mountRef} className="absolute inset-0" />

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

            <button
              className={`px-3 py-1 rounded ${
                showGroundPlane ? "bg-blue-600" : "bg-gray-600"
              }`}
              onClick={toggleGroundPlane}
            >
              {showGroundPlane ? "Hide Grid" : "Show Grid"}
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
                <button
                  className={`px-3 py-1 rounded ${
                    shape === "custom" ? "bg-blue-600" : "bg-gray-600"
                  }`}
                  onClick={() => setShape("custom")}
                >
                  Polygon
                </button>
              </div>
            </>
          )}

          {mode === "union" && canUnion && (
            <button
              className="px-4 py-2 bg-green-600 rounded mt-2"
              onClick={() => {
                performUnion();
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
