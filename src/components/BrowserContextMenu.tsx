import React, { useEffect, useRef, FC } from "react";
import { EyeIcon, EyeOffIcon } from "./icons/BrowserIcons";

interface BrowserContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string;
  nodeLabel: string;
  nodeVisible: boolean;
  onClose: () => void;
  onRename: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onToggleVisibility: (nodeId: string) => void;
}

const BrowserContextMenu: FC<BrowserContextMenuProps> = ({
  visible,
  x,
  y,
  nodeId,
  nodeVisible,
  onClose,
  onRename,
  onDelete,
  onToggleVisibility,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

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

  if (!visible) return null;

  return (
    <div
      ref={menuRef}
      className="bg-gray-800 rounded shadow-lg border border-gray-600 py-1 min-w-[140px]"
      style={{ position: "fixed", left: `${x}px`, top: `${y}px`, zIndex: 9999 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        onClick={() => { onRename(nodeId); onClose(); }}
        className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
      >
        Rename
      </button>
      <button
        onClick={() => { onDelete(nodeId); onClose(); }}
        className="w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2"
      >
        Delete
      </button>
      <div className="border-t border-gray-600 my-1" />
      <button
        onClick={() => { onToggleVisibility(nodeId); onClose(); }}
        className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
      >
        {nodeVisible ? (
          <><EyeOffIcon className="w-3.5 h-3.5" /> Hide</>
        ) : (
          <><EyeIcon className="w-3.5 h-3.5" /> Show</>
        )}
      </button>
    </div>
  );
};

export default BrowserContextMenu;
