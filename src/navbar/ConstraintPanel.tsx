import React, { FC, useState } from "react";
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
  getSelectionDescription,
} from "../scene-operations/constraint-validation";
import ValueInputModal from "./ValueInputModal";

interface ConstraintPanelProps {
  selectedPrimitives: string[];
  activeSketch: Sketch | null;
  onApplyConstraint: (type: ConstraintType, value?: number) => void;
}

// Define constraint button groups
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

const ConstraintPanel: FC<ConstraintPanelProps> = ({
  selectedPrimitives,
  activeSketch,
  onApplyConstraint,
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
      // Show value input modal
      const value = getDefaultValue(type, selectedPrimitives, activeSketch.primitives);
      setDefaultValue(value);
      setPendingConstraint(type);
    } else {
      // Apply directly
      onApplyConstraint(type);
    }
  };

  const handleValueConfirm = (value: number) => {
    if (pendingConstraint) {
      // Convert angle from degrees to radians for the solver
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

  const renderConstraintButton = (type: ConstraintType, available: boolean) => {
    const icon = getConstraintIcon(type);
    const label = getConstraintLabel(type);

    return (
      <button
        key={type}
        onClick={() => available && handleConstraintClick(type)}
        disabled={!available}
        className={`px-2 py-1 text-xs rounded font-mono ${
          available
            ? "bg-gray-600 hover:bg-blue-500 cursor-pointer"
            : "bg-gray-700 text-gray-500 cursor-not-allowed"
        }`}
        title={label}
      >
        {icon}
      </button>
    );
  };

  return (
    <div className="border-t border-gray-600 pt-3 mt-2">
      <h4 className="text-sm font-medium text-gray-300 mb-2">Constraints</h4>

      {/* Selection info */}
      <div className="text-xs text-gray-400 mb-2">
        Selected: {getSelectionDescription(selectedPrimitives, activeSketch.primitives)}
      </div>

      {/* Geometric constraints */}
      <div className="mb-2">
        <p className="text-xs text-gray-500 mb-1">Geometric:</p>
        <div className="flex flex-wrap gap-1">
          {GEOMETRIC_CONSTRAINTS.map((type) =>
            renderConstraintButton(type, availableConstraints.includes(type))
          )}
        </div>
      </div>

      {/* Dimensional constraints */}
      <div className="mb-2">
        <p className="text-xs text-gray-500 mb-1">Dimensional:</p>
        <div className="flex flex-wrap gap-1">
          {DIMENSIONAL_CONSTRAINTS.map((type) =>
            renderConstraintButton(type, availableConstraints.includes(type))
          )}
        </div>
      </div>

      {/* Value input modal */}
      {pendingConstraint && (
        <ValueInputModal
          constraintType={pendingConstraint}
          defaultValue={defaultValue}
          onConfirm={handleValueConfirm}
          onCancel={handleValueCancel}
        />
      )}

      {/* Help text */}
      {selectedPrimitives.length === 0 && (
        <div className="text-xs text-gray-500 mt-2">
          Click primitives to select (Shift+click for multi-select)
        </div>
      )}

      {selectedPrimitives.length > 0 && availableConstraints.length === 0 && (
        <div className="text-xs text-yellow-500 mt-2">
          No constraints available for this selection
        </div>
      )}
    </div>
  );
};

export default ConstraintPanel;
