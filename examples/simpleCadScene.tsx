import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { useCadCore } from "../src/contexts/CoreContext";
import { SceneMode } from "../src/scene-operations";
import { ShapeType, useCadVisualizer } from "../src/contexts/VisualizerContext";
import useMoveMode from "../src/hooks/useMoveMode";
import { useUnionMode } from "../src/hooks/useUnionMode";
import { useDifferenceMode } from "../src/hooks/useDifferenceMode";
import { useIntersectionMode } from "../src/hooks/useIntersectionMode";
import { useDrawMode } from "../src/hooks/useDrawMode";
import { useUngroupMode } from "../src/hooks/useUngroupMode";
import { useResizeMode } from "../src/hooks/useResizeMode";

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
    cursorPosition,
    updateCursorPosition,
  } = useCadVisualizer();

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
  const { handleDifferenceModeClick, performDifference, canDifference, selectedCount } =
    useDifferenceMode();
  const { handleIntersectionModeClick, performIntersection, canIntersect } =
    useIntersectionMode();
  const { handleUngroupModeClick, performUngroup, canUngroup } =
    useUngroupMode();

  const {
    handleDrawMode,
    previewMeshRef,
    isDrawingRef,
    startPointRef,
    cleanupPreview,
  } = useDrawMode();
  const {
    handleMouseDown: handleResizeMouseDown,
    handleMouseMove: handleResizeMouseMove,
    handleMouseUp: handleResizeMouseUp,
    cleanup: cleanupResize,
  } = useResizeMode();

  const selectedObjectRef = useRef<string | null>(null);
  useEffect(() => {
    selectedObjectRef.current = selectedObject;
  }, [selectedObject]);

  useEffect(() => {
    if (!mountRef.current) return;

    if (renderer) {
      unmountRenderer();
    }

    const cleanup = mountRenderer(mountRef.current);
    return cleanup;
  }, []);

  useEffect(() => {
    const setupElementVisualizations = () => {
      elements.forEach((element) => {
        const obj = getObject(element.nodeId);
        if (!obj) return;

        if (obj.userData.hasHelpers) return;

        const edgeHelper = createEdgeHelpers(element);
        const vertexHelper = createVertexHelpers(element);

        if (edgeHelper) {
          edgeHelper.visible = false;
          obj.add(edgeHelper);
        }

        if (vertexHelper) {
          vertexHelper.visible = false;
          obj.add(vertexHelper);
        }

        obj.userData.hasHelpers = true;
      });
    };

    if (scene) {
      setupElementVisualizations();
    }
  }, [elements, scene]);

  useEffect(() => {
    setCurrentShape(shape);
  }, [shape]);
  useEffect(() => {
    if (!renderer) return;

    const handleMouseMove = (event: MouseEvent) => {
      updateCursorPosition(event);
    };

    renderer.domElement.addEventListener("mousemove", handleMouseMove);

    return () => {
      renderer.domElement.removeEventListener("mousemove", handleMouseMove);
    };
  }, [renderer, updateCursorPosition]);

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

    const handleResizeMode = (event: MouseEvent) => {
      if (event.type === "mousedown") {
        handleResizeMouseDown(event);
      } else if (event.type === "mousemove") {
        handleResizeMouseMove(event);
      } else if (event.type === "mouseup") {
        handleResizeMouseUp();
      }
    };

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
    } else if (mode === "difference") {
      renderer.domElement.addEventListener("mousedown", handleDifferenceModeClick);
    } else if (mode === "intersection") {
      renderer.domElement.addEventListener("mousedown", handleIntersectionModeClick);
    } else if (mode === "resize") {
      renderer.domElement.addEventListener("mousedown", handleResizeMode);
      renderer.domElement.addEventListener("mousemove", handleResizeMode);
      renderer.domElement.addEventListener("mouseup", handleResizeMode);
    }

    return () => {
      renderer.domElement.removeEventListener("mousedown", handleDrawMode);
      renderer.domElement.removeEventListener("mousemove", handleDrawMode);
      renderer.domElement.removeEventListener("mouseup", handleDrawMode);
      renderer.domElement.removeEventListener("mousedown", handleMoveMode);
      renderer.domElement.removeEventListener("mousemove", handleMoveMode);
      renderer.domElement.removeEventListener("mouseup", handleMoveMode);
      renderer.domElement.removeEventListener(
        "mousedown",
        handleUnionModeClick
      );
      renderer.domElement.removeEventListener(
        "mousedown",
        handleDifferenceModeClick
      );
      renderer.domElement.removeEventListener(
        "mousedown",
        handleIntersectionModeClick
      );
      renderer.domElement.removeEventListener("mouseup", handleDrawMode);
      renderer.domElement.removeEventListener("mousedown", handleResizeMode);
      renderer.domElement.removeEventListener("mousemove", handleResizeMode);
      renderer.domElement.removeEventListener("mouseup", handleResizeMode);
      // cleanupPreview();
      // cleanupResize();
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
    handleDifferenceModeClick,
    handleIntersectionModeClick,
    clearSelection,
    cleanupPreview,
    handleDrawMode,
    handleResizeMouseDown,
    handleResizeMouseMove,
    handleResizeMouseUp,
    cleanupResize,
  ]);

  return (
    <div className="relative w-full h-screen">
      <div ref={mountRef} className="absolute inset-0" />

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
                mode === "resize" ? "bg-blue-600" : "bg-gray-600"
              }`}
              onClick={() => setMode("resize")}
            >
              Resize
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
                mode === "difference" ? "bg-blue-600" : "bg-gray-600"
              }`}
              onClick={() => setMode("difference")}
            >
              Difference
            </button>
            <button
              className={`px-3 py-1 rounded ${
                mode === "intersection" ? "bg-blue-600" : "bg-gray-600"
              }`}
              onClick={() => setMode("intersection")}
            >
              Intersection
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

          {mode === "difference" && (
            <div className="mt-2">
              <p className="text-sm text-gray-300 mb-1">
                Select base shape first, then tool(s) to subtract
              </p>
              {canDifference && (
                <button
                  className="px-4 py-2 bg-orange-600 rounded"
                  onClick={() => {
                    performDifference();
                  }}
                >
                  Subtract ({selectedCount - 1}) from Base
                </button>
              )}
            </div>
          )}

          {mode === "intersection" && (
            <div className="mt-2">
              <p className="text-sm text-gray-300 mb-1">
                Select 2+ shapes to get their common volume
              </p>
              {canIntersect && (
                <button
                  className="px-4 py-2 bg-purple-600 rounded"
                  onClick={() => {
                    performIntersection();
                  }}
                >
                  Intersect Selected ({selectedElements.length})
                </button>
              )}
            </div>
          )}

          <button
            onClick={performUngroup}
            disabled={!canUngroup}
            className={`px-3 py-1 rounded ${
              canUngroup ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-400"
            }`}
            title="Break compound object into its parts"
          >
            Ungroup
          </button>
        </div>
      </div>

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
                  // TODO copy
                }
              }}
            >
              Copy
            </button>
            <button
              className="px-3 py-1 text-left hover:bg-gray-700 rounded"
              onClick={() => {
                // TODO delete
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
      <div className="absolute bottom-4 left-4 bg-gray-800 bg-opacity-75 p-2 rounded text-white text-sm font-mono">
        <h3 className="font-bold">Cursor Position</h3>
        <p>
          X: {cursorPosition ? cursorPosition.x.toFixed(2) : "--"}
          <br />
          Y: {cursorPosition ? cursorPosition.y.toFixed(2) : "--"}
          <br />
          Z: {cursorPosition ? cursorPosition.z.toFixed(2) : "--"}
        </p>
      </div>

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
