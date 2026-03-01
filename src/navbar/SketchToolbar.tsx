import React, { FC, useState } from "react";
import { SketchSubMode } from "../hooks/useSketchMode";
import {
  Sketch,
  ConstraintType,
  GeometricConstraintType,
  DimensionalConstraintType,
} from "../types/sketch-types";
import {
  getAvailableConstraints,
  requiresValue,
  getDefaultValue,
  getConstraintIcon,
  getConstraintLabel,
} from "../scene-operations/constraint-validation";
import ValueInputModal from "./ValueInputModal";

interface SketchToolbarProps {
  activeSketch: Sketch | null;
  sketchSubMode: SketchSubMode;
  onSubModeChange: (mode: SketchSubMode) => void;
  onFinishSketch: () => void;
  onCancelSketch: () => void;
  onSolveSketch: () => void;
  selectedPrimitives: string[];
  onApplyConstraint: (type: ConstraintType, value?: number) => void;
  isChaining?: boolean;
  isOperationPending?: boolean;
}

const GEOMETRIC_CONSTRAINTS: GeometricConstraintType[] = [
  "horizontal",
  "vertical",
  "parallel",
  "perpendicular",
  "tangent",
  "equal",
  "coincident",
  "concentric",
  "pointOnLine",
  "pointOnCircle",
];

const DIMENSIONAL_CONSTRAINTS: DimensionalConstraintType[] = [
  "distance",
  "angle",
  "radius",
  "diameter",
];

const SketchToolbar: FC<SketchToolbarProps> = ({
  activeSketch,
  sketchSubMode,
  onSubModeChange,
  onFinishSketch,
  onCancelSketch,
  onSolveSketch,
  selectedPrimitives,
  onApplyConstraint,
  isChaining = false,
  isOperationPending = false,
}) => {
  const [pendingConstraint, setPendingConstraint] = useState<ConstraintType | null>(null);
  const [defaultValue, setDefaultValue] = useState<number | undefined>(undefined);

  if (!activeSketch) return null;

  const availableConstraints = getAvailableConstraints(
    selectedPrimitives,
    activeSketch.primitives
  );

  const handleConstraintClick = (type: ConstraintType) => {
    if (requiresValue(type)) {
      const value = getDefaultValue(type, selectedPrimitives, activeSketch.primitives);
      setDefaultValue(value);
      setPendingConstraint(type);
    } else {
      onApplyConstraint(type);
    }
  };

  const handleValueConfirm = (value: number) => {
    if (pendingConstraint) {
      const finalValue = pendingConstraint === "angle"
        ? (value * Math.PI) / 180
        : value;
      onApplyConstraint(pendingConstraint, finalValue);
      setPendingConstraint(null);
      setDefaultValue(undefined);
    }
  };

  const handleValueCancel = () => {
    setPendingConstraint(null);
    setDefaultValue(undefined);
  };

  const toolBtn = (mode: SketchSubMode, label: string, shortcut: string) => (
    <button
      className={`flex-none px-2 py-1 text-sm rounded ${
        isOperationPending
          ? "bg-gray-800 text-gray-500 cursor-not-allowed"
          : sketchSubMode === mode ? "bg-blue-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-gray-200"
      }`}
      disabled={isOperationPending}
      onClick={() => onSubModeChange(mode)}
      title={`${label} (${shortcut})`}
    >
      {label}
    </button>
  );

  const constraintBtn = (type: ConstraintType) => {
    const available = availableConstraints.includes(type) && !isOperationPending;
    const icon = getConstraintIcon(type);
    const label = getConstraintLabel(type);

    return (
      <button
        key={type}
        onClick={() => available && handleConstraintClick(type)}
        disabled={!available}
        className={`flex-none px-1.5 py-1 text-xs rounded font-mono ${
          available
            ? "bg-gray-700 hover:bg-blue-500 text-gray-200 cursor-pointer"
            : "bg-gray-700 opacity-50 cursor-not-allowed text-gray-500"
        }`}
        title={label}
      >
        {icon}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-1 w-full min-w-0 relative">
      {/* Drawing tools */}
      {toolBtn("line", "Line", "L")}
      {toolBtn("rectangle", "Rect", "R")}
      {toolBtn("circle", "Circle", "C")}
      {toolBtn("arc", "Arc", "A")}
      {toolBtn("point", "Point", "P")}
      {toolBtn("dimension", "Dim", "D")}
      {toolBtn("select", "Select", "S")}

      {/* Separator */}
      <div className="flex-none w-px h-5 bg-gray-600 mx-1" />

      {/* Trim/Extend */}
      {toolBtn("trim", "Trim", "T")}
      {toolBtn("extend", "Extend", "E")}

      {/* Separator */}
      <div className="flex-none w-px h-5 bg-gray-600 mx-1" />

      {/* Construction toggle */}
      <button
        className={`flex-none px-2 py-1 text-sm rounded ${
          isOperationPending
            ? "bg-gray-800 text-gray-500 cursor-not-allowed"
            : "bg-gray-700 hover:bg-orange-600 text-gray-200"
        }`}
        disabled={isOperationPending}
        onClick={() => {
          const event = new KeyboardEvent("keydown", { key: "x" });
          window.dispatchEvent(event);
        }}
        title="Toggle Construction (X)"
      >
        Constr
      </button>

      {/* Separator */}
      <div className="flex-none w-px h-5 bg-gray-600 mx-1" />

      {/* Geometric constraints */}
      {GEOMETRIC_CONSTRAINTS.map((type) => constraintBtn(type))}

      {/* Separator */}
      <div className="flex-none w-px h-5 bg-gray-600 mx-1" />

      {/* Dimensional constraints */}
      {DIMENSIONAL_CONSTRAINTS.map((type) => constraintBtn(type))}

      {/* Chain indicator */}
      {isChaining && (
        <span className="flex-none text-xs text-green-400 ml-1">Chain</span>
      )}

      {/* Spacer */}
      <div className="flex-1 min-w-0" />

      {/* Actions on the right */}
      <button
        className={`flex-none px-3 py-1 text-sm rounded ${
          isOperationPending
            ? "bg-gray-600 text-gray-400 cursor-wait"
            : "bg-green-600 hover:bg-green-500 text-white"
        }`}
        disabled={isOperationPending}
        onClick={onFinishSketch}
      >
        {isOperationPending ? "Finishing..." : "Finish"}
      </button>
      <button
        className={`flex-none px-3 py-1 text-sm rounded ${
          isOperationPending
            ? "bg-gray-800 text-gray-500 cursor-not-allowed"
            : "bg-red-600 hover:bg-red-500 text-white"
        }`}
        disabled={isOperationPending}
        onClick={onCancelSketch}
      >
        Cancel
      </button>

      {/* Value input dropdown for dimensional constraints */}
      {pendingConstraint && (
        <div className="absolute top-full mt-1 left-0 z-50">
          <ValueInputModal
            constraintType={pendingConstraint}
            defaultValue={defaultValue}
            onConfirm={handleValueConfirm}
            onCancel={handleValueCancel}
          />
        </div>
      )}
    </div>
  );
};

export default SketchToolbar;
