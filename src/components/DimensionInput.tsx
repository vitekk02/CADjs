import React, { useState, useRef, useEffect, FC } from "react";

interface DimensionInputProps {
  visible: boolean;
  position: { x: number; y: number };
  label: string;
  initialValue?: number;
  onSubmit: (value: number) => void;
  onCancel: () => void;
}

const DimensionInput: FC<DimensionInputProps> = ({
  visible,
  position,
  label,
  initialValue,
  onSubmit,
  onCancel,
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        onSubmit(numValue);
      }
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === "Escape" || e.key === "Tab") {
      onCancel();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
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
        <span className="text-xs text-gray-500">Enter</span>
      </div>
      <div className="text-xs text-gray-500 mt-1">
        Tab/Esc to skip
      </div>
    </div>
  );
};

export default DimensionInput;
