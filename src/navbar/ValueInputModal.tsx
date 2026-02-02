import React, { useState, useEffect, useRef, FC } from "react";
import { ConstraintType } from "../types/sketch-types";
import { getConstraintLabel } from "../scene-operations/constraint-validation";

interface ValueInputModalProps {
  constraintType: ConstraintType;
  defaultValue?: number;
  onConfirm: (value: number) => void;
  onCancel: () => void;
}

const ValueInputModal: FC<ValueInputModalProps> = ({
  constraintType,
  defaultValue = 0,
  onConfirm,
  onCancel,
}) => {
  const [value, setValue] = useState<string>(defaultValue.toFixed(2));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus input on mount
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        onConfirm(numValue);
      }
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  const handleSubmit = () => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue > 0) {
      onConfirm(numValue);
    }
  };

  const getUnit = (): string => {
    switch (constraintType) {
      case "angle":
        return "deg";
      case "radius":
      case "diameter":
      case "distance":
      case "distanceX":
      case "distanceY":
        return "units";
      default:
        return "";
    }
  };

  return (
    <div className="p-2 bg-gray-600 rounded mt-2">
      <div className="text-sm text-gray-300 mb-1">
        Enter {getConstraintLabel(constraintType).toLowerCase()}:
      </div>
      <div className="flex gap-2 items-center">
        <input
          ref={inputRef}
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-20 px-2 py-1 bg-gray-700 border border-gray-500 rounded text-white text-sm focus:outline-none focus:border-blue-500"
          step="0.1"
          min="0"
        />
        <span className="text-gray-400 text-sm">{getUnit()}</span>
        <button
          onClick={handleSubmit}
          className="px-2 py-1 bg-green-600 hover:bg-green-500 rounded text-sm"
        >
          OK
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1 bg-gray-500 hover:bg-gray-400 rounded text-sm"
        >
          Cancel
        </button>
      </div>
      <div className="text-xs text-gray-400 mt-1">
        Enter to confirm, Escape to cancel
      </div>
    </div>
  );
};

export default ValueInputModal;
