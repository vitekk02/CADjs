import React, { useState, useRef, useEffect, FC } from "react";

interface DimensionInputProps {
  visible: boolean;
  position: { x: number; y: number };
  label: string;
  initialValue?: number;
  externalValue?: number;
  onSubmit: (value: number) => void;
  onCancel: () => void;
  onChange?: (value: number) => void;
  showConfirmButton?: boolean;
}

const DimensionInput: FC<DimensionInputProps> = ({
  visible,
  position,
  label,
  initialValue,
  onSubmit,
  onCancel,
  onChange,
  showConfirmButton,
  externalValue,
}) => {
  const [value, setValue] = useState<string>(initialValue?.toFixed(2) ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when visible
  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [visible]);

  // Reset value when becoming visible with new initial value
  useEffect(() => {
    if (visible) {
      setValue(initialValue?.toFixed(2) ?? "");
    }
  }, [visible, initialValue]);

  // Sync value from external source (e.g., drag updates depth in real-time)
  useEffect(() => {
    if (externalValue !== undefined) {
      setValue(externalValue.toFixed(2));
    }
  }, [externalValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Stop all key events from reaching the scene (prevents camera movement on arrow keys, etc.)
    e.stopPropagation();

    if (e.key === "Enter") {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        onSubmit(numValue);
      }
      e.preventDefault();
    } else if (e.key === "Escape" || e.key === "Tab") {
      onCancel();
      e.preventDefault();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const current = parseFloat(value) || 0;
      const step = e.shiftKey ? 0.1 : 1;
      const newVal = e.key === "ArrowUp" ? current + step : Math.max(0.01, current - step);
      const rounded = parseFloat(newVal.toFixed(2));
      setValue(String(rounded));
      if (onChange && rounded > 0) {
        onChange(rounded);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    if (onChange) {
      const numValue = parseFloat(newValue);
      if (!isNaN(numValue) && numValue > 0) {
        onChange(numValue);
      }
    }
  };

  const handleConfirmClick = () => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue > 0) {
      onSubmit(numValue);
    }
  };

  if (!visible) return null;

  return (
    <div
      className="absolute z-50 bg-gray-800 rounded shadow-lg p-2 border border-blue-500"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: "translate(-50%, -100%) translateY(-10px)",
      }}
    >
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className="w-20 px-2 py-1 text-sm bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          placeholder="Value"
        />
        {showConfirmButton ? (
          <button
            onClick={handleConfirmClick}
            className="px-2 py-1 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded"
          >
            Confirm
          </button>
        ) : (
          <span className="text-xs text-gray-500">Enter</span>
        )}
      </div>
      <div className="text-xs text-gray-500 mt-1">
        {showConfirmButton ? "Esc to cancel" : "Tab/Esc to skip"}
      </div>
    </div>
  );
};

export default DimensionInput;
