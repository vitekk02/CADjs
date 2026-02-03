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
  onClose: () => void;
  onApplyConstraint: (type: ConstraintType, value?: number) => void;
}

const SketchContextMenu: FC<SketchContextMenuProps> = ({
  visible,
  x,
  y,
  primitiveIds,
  primitiveTypes,
  onClose,
  onApplyConstraint,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [valueInputVisible, setValueInputVisible] = React.useState(false);
  const [pendingConstraintType, setPendingConstraintType] = React.useState<ConstraintType | null>(null);
  const [inputValue, setInputValue] = React.useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when value input becomes visible
  useEffect(() => {
    if (valueInputVisible && inputRef.current) {
      inputRef.current.focus();
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
      // Show value input
      setPendingConstraintType(option.type);
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
      setValueInputVisible(false);
      setPendingConstraintType(null);
      setInputValue("");
      e.preventDefault();
      e.stopPropagation();
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
      {valueInputVisible ? (
        <div className="px-3 py-2">
          <div className="text-xs text-gray-400 mb-2">
            Enter {pendingConstraintType === "distance" ? "value" : pendingConstraintType}:
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
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
        </>
      )}
    </div>
  );
};

export default SketchContextMenu;
