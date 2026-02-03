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
import { useSketchMode } from "../src/hooks/useSketchMode";
import SketchToolbar from "../src/navbar/SketchToolbar";
import DimensionInput from "../src/components/DimensionInput";
import SketchContextMenu from "../src/components/SketchContextMenu";
// PlaneSelector removed - now using in-scene plane selection

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
    activeSketch,
    finishSketch,
    cancelSketch,
    solveSketch,
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

  const {
    sketchSubMode,
    setSketchSubMode,
    handleSketchMode,
    handleKeyDown: handleSketchKeyDown,
    cleanupSketchPreview,
    startNewSketch,
    selectedPrimitives,
    applyConstraint,
    isChaining,
    cancelCurrentOperation,
    pendingLineDimension,
    clearPendingLineDimension,
    applyLineLengthConstraint,
    contextMenu: sketchContextMenu,
    closeContextMenu: closeSketchContextMenu,
    applyConstraintToContextMenuPrimitives,
    // Plane selection
    isSelectingPlane,
    hoveredPlane,
    cancelPlaneSelection,
    selectPlaneAndStartSketch,
    handlePlaneSelectionMouseMove,
    handlePlaneSelectionClick,
  } = useSketchMode();

  // Dimension input state
  const [dimensionInputVisible, setDimensionInputVisible] = useState(false);
  const [dimensionInputPosition, setDimensionInputPosition] = useState({ x: 0, y: 0 });
  const [dimensionInputLabel, setDimensionInputLabel] = useState("");
  const [dimensionInputValue, setDimensionInputValue] = useState<number | undefined>(undefined);
  const [pendingDimensionPrimitiveId, setPendingDimensionPrimitiveId] = useState<string | null>(null);
  const [dimensionSource, setDimensionSource] = useState<"lineCreation" | "dimensionMode" | null>(null);

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

  // Global keyboard listener for sketch mode shortcuts
  useEffect(() => {
    if (mode !== "sketch") return;

    window.addEventListener("keydown", handleSketchKeyDown);

    return () => {
      window.removeEventListener("keydown", handleSketchKeyDown);
    };
  }, [mode, handleSketchKeyDown]);

  // Prevent default browser context menu in sketch mode
  useEffect(() => {
    if (mode !== "sketch" || !renderer) return;

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    renderer.domElement.addEventListener("contextmenu", handleContextMenu);

    return () => {
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [mode, renderer]);

  // Show dimension input when primitive is selected in dimension mode
  useEffect(() => {
    // Don't interfere if showing line-creation dimension input
    if (dimensionSource === "lineCreation") return;

    if (mode !== "sketch" || sketchSubMode !== "dimension" || selectedPrimitives.length !== 1) {
      if (dimensionSource === "dimensionMode") {
        setDimensionInputVisible(false);
        setPendingDimensionPrimitiveId(null);
        setDimensionSource(null);
      }
      return;
    }

    const primitiveId = selectedPrimitives[0];
    if (!activeSketch || !renderer) return;

    // Find the primitive
    const primitive = activeSketch.primitives.find((p) => p.id === primitiveId);
    if (!primitive) return;

    // Determine dimension type and position based on primitive type
    let label = "";
    let value: number | undefined;
    let worldPos = new THREE.Vector3();

    if (primitive.type === "line") {
      label = "Length";
      // Get line endpoints to calculate length and position
      const p1 = activeSketch.primitives.find((p) => p.id === primitive.p1Id && p.type === "point");
      const p2 = activeSketch.primitives.find((p) => p.id === primitive.p2Id && p.type === "point");
      if (p1 && p2 && p1.type === "point" && p2.type === "point") {
        const length = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
        value = length;
        worldPos.set((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 0);
      }
    } else if (primitive.type === "circle") {
      label = "Radius";
      value = primitive.radius;
      const center = activeSketch.primitives.find((p) => p.id === primitive.centerId && p.type === "point");
      if (center && center.type === "point") {
        worldPos.set(center.x + primitive.radius / 2, center.y, 0);
      }
    } else if (primitive.type === "arc") {
      label = "Radius";
      value = primitive.radius;
      const center = activeSketch.primitives.find((p) => p.id === primitive.centerId && p.type === "point");
      if (center && center.type === "point") {
        worldPos.set(center.x, center.y, 0);
      }
    } else {
      // Point or other - no dimension to add
      setDimensionInputVisible(false);
      return;
    }

    // Convert world position to screen position
    if (camera) {
      worldPos.project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      const screenX = ((worldPos.x + 1) / 2) * rect.width + rect.left;
      const screenY = ((-worldPos.y + 1) / 2) * rect.height + rect.top;

      setDimensionInputPosition({ x: screenX, y: screenY });
      setDimensionInputLabel(label);
      setDimensionInputValue(value);
      setPendingDimensionPrimitiveId(primitiveId);
      setDimensionSource("dimensionMode");
      setDimensionInputVisible(true);
    }
  }, [mode, sketchSubMode, selectedPrimitives, activeSketch, camera, renderer, dimensionSource]);

  // Show dimension input immediately after line creation
  useEffect(() => {
    if (!pendingLineDimension || !renderer || !camera) {
      return;
    }

    // Convert line midpoint to screen position
    const worldPos = pendingLineDimension.midpoint.clone();
    worldPos.project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    const screenX = ((worldPos.x + 1) / 2) * rect.width + rect.left;
    const screenY = ((-worldPos.y + 1) / 2) * rect.height + rect.top;

    setDimensionInputPosition({ x: screenX, y: screenY });
    setDimensionInputLabel("Length");
    setDimensionInputValue(pendingLineDimension.length);
    setPendingDimensionPrimitiveId(pendingLineDimension.lineId);
    setDimensionSource("lineCreation");
    setDimensionInputVisible(true);
  }, [pendingLineDimension, renderer, camera]);

  // Handle dimension input submission
  const handleDimensionSubmit = (value: number) => {
    if (!pendingDimensionPrimitiveId) return;

    if (dimensionSource === "lineCreation") {
      // Apply length constraint to the newly created line
      applyLineLengthConstraint(pendingDimensionPrimitiveId, value);
    } else if (dimensionSource === "dimensionMode" && activeSketch) {
      const primitive = activeSketch.primitives.find((p) => p.id === pendingDimensionPrimitiveId);
      if (!primitive) return;

      // Apply appropriate constraint based on primitive type
      if (primitive.type === "line") {
        applyConstraint("distance", value);
      } else if (primitive.type === "circle" || primitive.type === "arc") {
        applyConstraint("radius", value);
      }
    }

    setDimensionInputVisible(false);
    setPendingDimensionPrimitiveId(null);
    setDimensionSource(null);
  };

  const handleDimensionCancel = () => {
    if (dimensionSource === "lineCreation") {
      clearPendingLineDimension();
    }
    setDimensionInputVisible(false);
    setPendingDimensionPrimitiveId(null);
    setDimensionSource(null);
  };

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
    } else if (mode === "sketch") {
      renderer.domElement.addEventListener("mousedown", handleSketchMode);
      renderer.domElement.addEventListener("mousemove", handleSketchMode);
      renderer.domElement.addEventListener("mouseup", handleSketchMode);
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
      renderer.domElement.removeEventListener("mousedown", handleSketchMode);
      renderer.domElement.removeEventListener("mousemove", handleSketchMode);
      renderer.domElement.removeEventListener("mouseup", handleSketchMode);
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
    handleSketchMode,
  ]);

  // Plane selection event listeners
  useEffect(() => {
    if (!renderer || !isSelectingPlane) return;

    renderer.domElement.addEventListener("mousemove", handlePlaneSelectionMouseMove);
    renderer.domElement.addEventListener("click", handlePlaneSelectionClick);

    return () => {
      renderer.domElement.removeEventListener("mousemove", handlePlaneSelectionMouseMove);
      renderer.domElement.removeEventListener("click", handlePlaneSelectionClick);
    };
  }, [renderer, isSelectingPlane, handlePlaneSelectionMouseMove, handlePlaneSelectionClick]);

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
                mode === "sketch" ? "bg-blue-600" : "bg-gray-600"
              }`}
              onClick={() => {
                if (mode !== "sketch") {
                  setMode("sketch");
                  startNewSketch();
                } else if (!activeSketch) {
                  // Already in sketch mode but no active sketch - start new one
                  startNewSketch();
                }
              }}
            >
              Sketch
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

          {mode === "sketch" && !isSelectingPlane && activeSketch && (
            <SketchToolbar
              activeSketch={activeSketch}
              sketchSubMode={sketchSubMode}
              onSubModeChange={setSketchSubMode}
              onFinishSketch={finishSketch}
              onCancelSketch={cancelSketch}
              onSolveSketch={solveSketch}
              selectedPrimitives={selectedPrimitives}
              onApplyConstraint={applyConstraint}
              isChaining={isChaining}
            />
          )}
        </div>
      </div>

      {/* Dimension input overlay */}
      <DimensionInput
        visible={dimensionInputVisible}
        position={dimensionInputPosition}
        label={dimensionInputLabel}
        initialValue={dimensionInputValue}
        onSubmit={handleDimensionSubmit}
        onCancel={handleDimensionCancel}
      />

      {/* Sketch context menu for right-click constraints */}
      {mode === "sketch" && (
        <SketchContextMenu
          visible={sketchContextMenu.visible}
          x={sketchContextMenu.x}
          y={sketchContextMenu.y}
          primitiveIds={sketchContextMenu.primitiveIds}
          primitiveTypes={sketchContextMenu.primitiveTypes}
          onClose={closeSketchContextMenu}
          onApplyConstraint={applyConstraintToContextMenuPrimitives}
        />
      )}

      {/* Plane selection hint overlay */}
      {mode === "sketch" && isSelectingPlane && (
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-20 pointer-events-none">
          <div className="bg-gray-800 bg-opacity-90 rounded-lg px-6 py-3 text-white shadow-lg">
            <div className="text-center">
              <p className="text-sm font-medium mb-2">Select a sketch plane</p>
              <p className="text-xs text-gray-400 mb-2">Click on a colored plane in the scene</p>
              {hoveredPlane && (
                <p className="text-sm font-bold" style={{
                  color: hoveredPlane === "XY" ? "#4488ff" :
                         hoveredPlane === "XZ" ? "#44ff44" : "#ff4444"
                }}>
                  {hoveredPlane === "XY" ? "XY Plane (Front)" :
                   hoveredPlane === "XZ" ? "XZ Plane (Top)" : "YZ Plane (Side)"}
                </p>
              )}
              <div className="mt-3 flex justify-center gap-2 pointer-events-auto">
                <button
                  className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500"
                  onClick={() => selectPlaneAndStartSketch("XY")}
                >
                  XY
                </button>
                <button
                  className="px-3 py-1 text-xs rounded bg-green-600 hover:bg-green-500"
                  onClick={() => selectPlaneAndStartSketch("XZ")}
                >
                  XZ
                </button>
                <button
                  className="px-3 py-1 text-xs rounded bg-red-600 hover:bg-red-500"
                  onClick={() => selectPlaneAndStartSketch("YZ")}
                >
                  YZ
                </button>
                <button
                  className="px-3 py-1 text-xs rounded bg-gray-600 hover:bg-gray-500"
                  onClick={cancelPlaneSelection}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {selectedObjectRef.current && (() => {
        // Cache element lookup to avoid repeated O(n) searches
        const selectedElement = elements.find((el) => el.nodeId === selectedObjectRef.current);
        return (
          <div className="absolute bottom-0 right-0 p-4 bg-gray-800 bg-opacity-75 rounded-tl-lg text-white">
            <h3 className="font-bold">Element Info</h3>
            <p>ID: {selectedObjectRef.current}</p>
            {selectedElement && (
              <>
                <p>
                  Position:{" "}
                  {`X: ${selectedElement.position.x.toFixed(2)},
                   Y: ${selectedElement.position.y.toFixed(2)},
                   Z: ${selectedElement.position.z.toFixed(2)}`}
                </p>
                <p>
                  Vertices:{" "}
                  {selectedElement.brep.vertices?.length || 0}
                </p>
                <p>
                  Edges:{" "}
                  {selectedElement.brep.edges?.length || 0}
                </p>
                <p>
                  Faces:{" "}
                  {selectedElement.brep.faces?.length || 0}
                </p>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default SimpleCadScene;
