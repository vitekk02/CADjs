import React, { useEffect, useRef, FC } from "react";
import { ConstraintType } from "../types/sketch-types";

interface ConstraintOption {
  type: ConstraintType;
  label: string;
  requiresValue?: boolean;
  applicableTo: string[]; // primitive types this constraint applies to
  minPrimitives?: number; // minimum number of primitives required
  maxPrimitives?: number; // maximum number of primitives allowed
}

// Define available constraints and their applicability
const CONSTRAINT_OPTIONS: ConstraintOption[] = [
  { type: "horizontal", label: "Horizontal", applicableTo: ["line"], minPrimitives: 1 },
  { type: "vertical", label: "Vertical", applicableTo: ["line"], minPrimitives: 1 },
  { type: "distance", label: "Length", requiresValue: true, applicableTo: ["line"], minPrimitives: 1, maxPrimitives: 1 },
  { type: "distance", label: "Distance", requiresValue: true, applicableTo: ["point"], minPrimitives: 2, maxPrimitives: 2 },
  { type: "radius", label: "Radius", requiresValue: true, applicableTo: ["circle", "arc"], minPrimitives: 1, maxPrimitives: 1 },
  { type: "coincident", label: "Coincident", applicableTo: ["point"], minPrimitives: 2, maxPrimitives: 2 },
  { type: "parallel", label: "Parallel", applicableTo: ["line"], minPrimitives: 2, maxPrimitives: 2 },
  { type: "perpendicular", label: "Perpendicular", applicableTo: ["line"], minPrimitives: 2, maxPrimitives: 2 },
  { type: "equal", label: "Equal", applicableTo: ["line", "circle", "arc"], minPrimitives: 2 },
  { type: "tangent", label: "Tangent", applicableTo: ["line", "circle", "arc"], minPrimitives: 2, maxPrimitives: 2 },
  { type: "concentric", label: "Concentric", applicableTo: ["circle", "arc"], minPrimitives: 2, maxPrimitives: 2 },
  { type: "midpoint", label: "Midpoint", applicableTo: ["point", "line"], minPrimitives: 2, maxPrimitives: 2 },
];

interface SketchContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  primitiveIds: string[];
  primitiveTypes: string[];
  constraintId?: string | null;
  onClose: () => void;
  onApplyConstraint: (type: ConstraintType, value?: number) => void;
  onDeleteConstraint?: (id: string) => void;
  onToggleFixPoint?: () => void;
  onDeletePrimitive?: () => void;
  onGetCurrentValue?: (type: ConstraintType) => number | undefined;
  onValueChange?: (type: ConstraintType, value: number) => void;
  onValueCancel?: () => void;
}

const SketchContextMenu: FC<SketchContextMenuProps> = ({
  visible,
  x,
  y,
  primitiveIds,
  primitiveTypes,
  constraintId,
  onClose,
  onApplyConstraint,
  onDeleteConstraint,
  onToggleFixPoint,
  onDeletePrimitive,
  onGetCurrentValue,
  onValueChange,
  onValueCancel,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [valueInputVisible, setValueInputVisible] = React.useState(false);
  const [pendingConstraintType, setPendingConstraintType] = React.useState<ConstraintType | null>(null);
  const [inputValue, setInputValue] = React.useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus and select all text when value input becomes visible
  useEffect(() => {
    if (valueInputVisible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [valueInputVisible]);

  // Reset state when menu closes
  useEffect(() => {
    if (!visible) {
      setValueInputVisible(false);
      setPendingConstraintType(null);
      setInputValue("");
    }
  }, [visible]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        event.preventDefault();
        event.stopPropagation();
      }
    };

    // Use setTimeout to avoid immediate trigger from the right-click that opened menu
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [visible, onClose]);

  // Filter constraints based on selected primitive types
  const getApplicableConstraints = (): ConstraintOption[] => {
    const numPrimitives = primitiveIds.length;

    return CONSTRAINT_OPTIONS.filter((option) => {
      // Check primitive count
      if (option.minPrimitives && numPrimitives < option.minPrimitives) return false;
      if (option.maxPrimitives && numPrimitives > option.maxPrimitives) return false;

      // Check if all primitive types are applicable
      return primitiveTypes.every((type) => option.applicableTo.includes(type));
    });
  };

  const handleConstraintClick = (option: ConstraintOption) => {
    if (option.requiresValue) {
      // Show value input, pre-filled with current value if available
      setPendingConstraintType(option.type);
      const currentValue = onGetCurrentValue?.(option.type);
      setInputValue(currentValue !== undefined ? currentValue.toFixed(2) : "");
      setValueInputVisible(true);
    } else {
      // Apply constraint directly
      onApplyConstraint(option.type);
    }
  };

  const handleValueSubmit = () => {
    if (pendingConstraintType && inputValue) {
      const value = parseFloat(inputValue);
      if (!isNaN(value) && value > 0) {
        onApplyConstraint(pendingConstraintType, value);
      }
    }
  };

  const handleValueKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleValueSubmit();
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === "Escape") {
      onValueCancel?.();
      setValueInputVisible(false);
      setPendingConstraintType(null);
      setInputValue("");
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 0.1 : 1;
      const current = parseFloat(inputValue) || 0;
      const newVal = e.key === "ArrowUp" ? current + step : Math.max(0.01, current - step);
      const newStr = newVal.toFixed(2);
      setInputValue(newStr);
      if (onValueChange && pendingConstraintType && newVal > 0) {
        onValueChange(pendingConstraintType, newVal);
      }
    }
  };

  if (!visible) return null;

  const applicableConstraints = getApplicableConstraints();

  // Position menu to stay within viewport
  const menuStyle: React.CSSProperties = {
    position: "fixed",
    left: `${x}px`,
    top: `${y}px`,
    zIndex: 9999,
  };

  return (
    <div
      ref={menuRef}
      className="bg-gray-800 rounded shadow-lg border border-gray-600 py-1 min-w-[160px]"
      style={menuStyle}
      onContextMenu={(e) => e.preventDefault()}
    >
      {constraintId && onDeleteConstraint ? (
        <>
          <div className="px-3 py-1 text-xs text-gray-400 border-b border-gray-700">
            Constraint
          </div>
          <button
            onClick={() => {
              onDeleteConstraint(constraintId);
              onClose();
            }}
            className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2"
          >
            <span>Delete Constraint</span>
          </button>
        </>
      ) : valueInputVisible ? (
        <div className="px-3 py-2">
          <div className="text-xs text-gray-400 mb-2">
            Enter {pendingConstraintType === "distance" ? "value" : pendingConstraintType}:
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => {
                const val = e.target.value;
                setInputValue(val);
                if (onValueChange && pendingConstraintType) {
                  const num = parseFloat(val);
                  if (!isNaN(num) && num > 0) {
                    onValueChange(pendingConstraintType, num);
                  }
                }
              }}
              onKeyDown={handleValueKeyDown}
              className="w-20 px-2 py-1 text-sm bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder="Value"
            />
            <button
              onClick={handleValueSubmit}
              className="px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              OK
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="px-3 py-1 text-xs text-gray-400 border-b border-gray-700">
            Constraints ({primitiveIds.length} selected)
          </div>
          {onToggleFixPoint && primitiveTypes.some(t => t === "point") && (
            <button
              onClick={() => {
                onToggleFixPoint();
                onClose();
              }}
              className="w-full px-3 py-2 text-left text-sm text-white hover:bg-gray-700 flex items-center gap-2 border-b border-gray-700"
            >
              <span>Fix/Unfix Point</span>
            </button>
          )}
          {applicableConstraints.length > 0 ? (
            applicableConstraints.map((option, index) => (
              <button
                key={`${option.type}-${option.label}-${index}`}
                onClick={() => handleConstraintClick(option)}
                className="w-full px-3 py-2 text-left text-sm text-white hover:bg-gray-700 flex items-center justify-between"
              >
                <span>{option.label}</span>
                {option.requiresValue && (
                  <span className="text-xs text-gray-500">...</span>
                )}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-gray-500">
              No constraints available
            </div>
          )}
          {onDeletePrimitive && primitiveIds.length > 0 && (
            <button
              onClick={() => {
                onDeletePrimitive();
                onClose();
              }}
              className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-gray-700 flex items-center justify-between border-t border-gray-700"
            >
              <span>Delete{primitiveIds.length > 1 ? ` (${primitiveIds.length})` : ""}</span>
              <span className="text-xs text-gray-500">Del</span>
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default SketchContextMenu;
