import React, { FC } from "react";
import { SketchSubMode } from "../hooks/useSketchMode";
import { Sketch, ConstraintType } from "../types/sketch-types";
import ConstraintPanel from "./ConstraintPanel";

interface SketchToolbarProps {
  activeSketch: Sketch | null;
  sketchSubMode: SketchSubMode;
  onSubModeChange: (mode: SketchSubMode) => void;
  onFinishSketch: () => void;
  onCancelSketch: () => void;
  onSolveSketch: () => void;
  selectedPrimitives: string[];
  onApplyConstraint: (type: ConstraintType, value?: number) => void;
}

const SketchToolbar: FC<SketchToolbarProps> = ({
  activeSketch,
  sketchSubMode,
  onSubModeChange,
  onFinishSketch,
  onCancelSketch,
  onSolveSketch,
  selectedPrimitives,
  onApplyConstraint,
}) => {
  if (!activeSketch) return null;

  const getStatusColor = () => {
    switch (activeSketch.status) {
      case "fully_constrained":
        return "text-green-400";
      case "overconstrained":
        return "text-red-400";
      default:
        return "text-yellow-400";
    }
  };

  const getStatusText = () => {
    switch (activeSketch.status) {
      case "fully_constrained":
        return "Fully Constrained";
      case "overconstrained":
        return "Over-constrained";
      default:
        return "Under-constrained";
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="border-t border-gray-600 pt-3">
        <h3 className="font-bold text-blue-400 mb-2">Sketch Mode</h3>

        {/* Primitive tools */}
        <div className="mb-3">
          <p className="text-xs text-gray-400 mb-1">Primitives:</p>
          <div className="flex flex-wrap gap-1">
            <button
              className={`px-2 py-1 text-sm rounded ${
                sketchSubMode === "point" ? "bg-blue-600" : "bg-gray-600"
              } hover:bg-blue-500`}
              onClick={() => onSubModeChange("point")}
              title="Add point (P)"
            >
              Point
            </button>
            <button
              className={`px-2 py-1 text-sm rounded ${
                sketchSubMode === "line" ? "bg-blue-600" : "bg-gray-600"
              } hover:bg-blue-500`}
              onClick={() => onSubModeChange("line")}
              title="Draw line (L)"
            >
              Line
            </button>
            <button
              className={`px-2 py-1 text-sm rounded ${
                sketchSubMode === "circle" ? "bg-blue-600" : "bg-gray-600"
              } hover:bg-blue-500`}
              onClick={() => onSubModeChange("circle")}
              title="Draw circle (C)"
            >
              Circle
            </button>
            <button
              className={`px-2 py-1 text-sm rounded ${
                sketchSubMode === "arc" ? "bg-blue-600" : "bg-gray-600"
              } hover:bg-blue-500`}
              onClick={() => onSubModeChange("arc")}
              title="Draw arc (A)"
            >
              Arc
            </button>
            <button
              className={`px-2 py-1 text-sm rounded ${
                sketchSubMode === "select" ? "bg-blue-600" : "bg-gray-600"
              } hover:bg-blue-500`}
              onClick={() => onSubModeChange("select")}
              title="Select (S)"
            >
              Select
            </button>
          </div>
        </div>

        {/* Constraints panel - only show in select mode */}
        {sketchSubMode === "select" && (
          <ConstraintPanel
            selectedPrimitives={selectedPrimitives}
            activeSketch={activeSketch}
            onApplyConstraint={onApplyConstraint}
          />
        )}

        {/* Sketch info */}
        <div className="mb-3 p-2 bg-gray-700 rounded text-sm">
          <div className="flex justify-between items-center mb-1">
            <span className="text-gray-400">DOF:</span>
            <span className={activeSketch.dof === 0 ? "text-green-400" : "text-yellow-400"}>
              {activeSketch.dof}
            </span>
          </div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-gray-400">Status:</span>
            <span className={getStatusColor()}>{getStatusText()}</span>
          </div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-gray-400">Primitives:</span>
            <span>{activeSketch.primitives.length}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Constraints:</span>
            <span>{activeSketch.constraints.length}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            className="px-3 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-medium"
            onClick={onFinishSketch}
          >
            Finish Sketch
          </button>
          <button
            className="px-3 py-2 bg-yellow-600 hover:bg-yellow-500 rounded text-sm font-medium"
            onClick={onSolveSketch}
          >
            Re-solve
          </button>
          <button
            className="px-3 py-2 bg-red-600 hover:bg-red-500 rounded text-sm font-medium"
            onClick={onCancelSketch}
          >
            Cancel Sketch
          </button>
        </div>
      </div>

      {/* Instructions */}
      <div className="text-xs text-gray-400 border-t border-gray-600 pt-2">
        <p className="font-medium mb-1">Instructions:</p>
        {sketchSubMode === "line" && (
          <p>Click and drag to draw a line</p>
        )}
        {sketchSubMode === "circle" && (
          <p>Click center, drag to set radius</p>
        )}
        {sketchSubMode === "arc" && (
          <p>Click: 1) center, 2) start, 3) end</p>
        )}
        {sketchSubMode === "point" && (
          <p>Click to place a point</p>
        )}
        {sketchSubMode === "select" && (
          <>
            <p>Click to select primitives</p>
            <p>Shift+click for multi-select (max 2)</p>
            <p>Apply constraints from panel above</p>
          </>
        )}
      </div>
    </div>
  );
};

export default SketchToolbar;
