import React, { FC, useState, useRef, useEffect } from "react";
import { BrowserSection, BrowserItem, OperationType } from "../types/sketch-types";
import {
  SketchIcon,
  BodyIcon,
  ProfileIcon,
  PlaneIcon,
  AxisIcon,
  OriginPointIcon,
  UnionIcon,
  DifferenceIcon,
  IntersectionIcon,
  ExtrudeIcon,
  SweepIcon,
  LoftIcon,
  EyeIcon,
  EyeOffIcon,
  ChevronIcon,
} from "./icons/BrowserIcons";
import BrowserContextMenu from "./BrowserContextMenu";

interface BrowserPanelProps {
  sections: BrowserSection[];
  selectedElementId?: string;
  onSelectNode: (elementId: string) => void;
  onToggleVisibility: (nodeId: string) => void;
  onToggleSectionExpanded: (sectionId: string) => void;
  onToggleItemExpanded: (nodeId: string) => void;
  onRenameNode: (nodeId: string, newName: string) => void;
  onDeleteNode: (nodeId: string) => void;
}

// ── Item Icon ────────────────────────────────────────────────────────

const ItemIcon: FC<{ itemType: BrowserItem["itemType"]; operationType?: OperationType }> = ({
  itemType,
  operationType,
}) => {
  const cls = "w-4 h-4 flex-none";
  switch (itemType) {
    case "sketch":
      return <SketchIcon className={cls} />;
    case "body":
      return <BodyIcon className={cls} />;
    case "profile":
      return <ProfileIcon className={cls} />;
    case "plane":
      return <PlaneIcon className={cls} />;
    case "axis":
      return <AxisIcon className={cls} />;
    case "origin-point":
      return <OriginPointIcon className={cls} />;
    case "operation":
      switch (operationType) {
        case "union":
          return <UnionIcon className={cls} />;
        case "difference":
          return <DifferenceIcon className={cls} />;
        case "intersection":
          return <IntersectionIcon className={cls} />;
        case "extrude":
          return <ExtrudeIcon className={cls} />;
        case "sweep":
          return <SweepIcon className={cls} />;
        case "loft":
          return <LoftIcon className={cls} />;
        default:
          return <BodyIcon className={cls} />;
      }
    default:
      return <BodyIcon className={cls} />;
  }
};

// ── Inline Rename Input ──────────────────────────────────────────────

const InlineRename: FC<{
  initialName: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}> = ({ initialName, onSubmit, onCancel }) => {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const trimmed = value.trim();
      if (trimmed) onSubmit(trimmed);
      else onCancel();
    } else if (e.key === "Escape") {
      onCancel();
    }
    e.stopPropagation();
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== initialName) onSubmit(trimmed);
        else onCancel();
      }}
      className="flex-1 min-w-0 px-1 py-0 text-sm bg-gray-700 text-white rounded border border-blue-500 focus:outline-none"
    />
  );
};

// ── Browser Item Row ─────────────────────────────────────────────────

const BrowserItemRow: FC<{
  item: BrowserItem;
  depth: number;
  selectedElementId?: string;
  renamingNodeId: string | null;
  onSelect: (elementId: string) => void;
  onToggleVisibility: (nodeId: string) => void;
  onToggleExpanded: (nodeId: string) => void;
  onContextMenu: (e: React.MouseEvent, item: BrowserItem) => void;
  onStartRename: (nodeId: string) => void;
  onFinishRename: (nodeId: string, newName: string) => void;
  onCancelRename: () => void;
}> = ({
  item,
  depth,
  selectedElementId,
  renamingNodeId,
  onSelect,
  onToggleVisibility,
  onToggleExpanded,
  onContextMenu,
  onStartRename,
  onFinishRename,
  onCancelRename,
}) => {
  const isSelected = item.elementId != null && item.elementId === selectedElementId;
  const hasChildren = item.children && item.children.length > 0;
  const isRenaming = renamingNodeId === item.sourceNodeId;

  const handleClick = () => {
    if (item.elementId) {
      onSelect(item.elementId);
    }
  };

  const handleDoubleClick = () => {
    if (item.sourceNodeId) {
      onStartRename(item.sourceNodeId);
    }
  };

  return (
    <>
      <div
        className={`group flex items-center py-1 pr-1 cursor-pointer rounded-sm ${
          isSelected
            ? "bg-blue-900/60 border-l-2 border-blue-400"
            : "border-l-2 border-transparent hover:bg-gray-700/50"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => onContextMenu(e, item)}
      >
        {/* Expand chevron */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren && item.sourceNodeId) onToggleExpanded(item.sourceNodeId);
          }}
          className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-300 flex-none mr-0.5"
        >
          {hasChildren ? <ChevronIcon className="w-3 h-3" expanded={item.expanded} /> : null}
        </button>

        {/* Icon */}
        <span className={`mr-1.5 flex-none ${item.visible ? "text-gray-400" : "text-gray-600"}`}>
          <ItemIcon itemType={item.itemType} operationType={item.operationType} />
        </span>

        {/* Name or inline rename */}
        {isRenaming && item.sourceNodeId ? (
          <InlineRename
            initialName={item.label}
            onSubmit={(name) => onFinishRename(item.sourceNodeId!, name)}
            onCancel={onCancelRename}
          />
        ) : (
          <span
            className={`text-sm truncate flex-1 min-w-0 ${
              item.visible ? "text-gray-200" : "text-gray-500"
            }`}
          >
            {item.label}
          </span>
        )}

        {/* Visibility eye (shown on hover or when hidden) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (item.sourceNodeId) onToggleVisibility(item.sourceNodeId);
          }}
          className={`flex-none ml-1 w-5 h-5 flex items-center justify-center rounded ${
            item.visible
              ? "opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-200"
              : "text-gray-600 hover:text-gray-400"
          }`}
          title={item.visible ? "Hide" : "Show"}
        >
          {item.visible ? <EyeIcon /> : <EyeOffIcon />}
        </button>
      </div>

      {/* Children */}
      {hasChildren && item.expanded && item.children!.map((child) => (
        <BrowserItemRow
          key={child.id}
          item={child}
          depth={depth + 1}
          selectedElementId={selectedElementId}
          renamingNodeId={renamingNodeId}
          onSelect={onSelect}
          onToggleVisibility={onToggleVisibility}
          onToggleExpanded={onToggleExpanded}
          onContextMenu={onContextMenu}
          onStartRename={onStartRename}
          onFinishRename={onFinishRename}
          onCancelRename={onCancelRename}
        />
      ))}
    </>
  );
};

// ── Section Header ───────────────────────────────────────────────────

const SectionHeader: FC<{
  section: BrowserSection;
  onToggle: (sectionId: string) => void;
}> = ({ section, onToggle }) => (
  <button
    onClick={() => onToggle(section.id)}
    className="w-full flex items-center py-1.5 px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:bg-gray-700/30"
  >
    <ChevronIcon className="w-3 h-3 mr-1 flex-none" expanded={section.expanded} />
    <span className="flex-1 text-left">{section.label}</span>
    {section.count > 0 && (
      <span className="text-gray-500 font-normal normal-case tracking-normal">
        ({section.count})
      </span>
    )}
  </button>
);

// ── Main BrowserPanel ────────────────────────────────────────────────

const BrowserPanel: FC<BrowserPanelProps> = ({
  sections,
  selectedElementId,
  onSelectNode,
  onToggleVisibility,
  onToggleSectionExpanded,
  onToggleItemExpanded,
  onRenameNode,
  onDeleteNode,
}) => {
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    item: BrowserItem | null;
  }>({ visible: false, x: 0, y: 0, item: null });

  const handleContextMenu = (e: React.MouseEvent, item: BrowserItem) => {
    // Only show context menu for items with a source node (not static origin items)
    if (!item.sourceNodeId) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, item });
  };

  const handleStartRename = (nodeId: string) => {
    setRenamingNodeId(nodeId);
  };

  const handleFinishRename = (nodeId: string, newName: string) => {
    onRenameNode(nodeId, newName);
    setRenamingNodeId(null);
  };

  const handleCancelRename = () => {
    setRenamingNodeId(null);
  };

  const hasAnyItems = sections.some((s) => s.sectionType !== "origin" && s.count > 0);

  return (
    <div className="h-full flex flex-col bg-gray-800/90">
      {/* Panel header */}
      <div className="flex-none px-3 py-2 border-b border-gray-700">
        <h2 className="text-white font-bold text-sm">Browser</h2>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto py-0.5">
        {sections.map((section) => (
          <div key={section.id}>
            <SectionHeader section={section} onToggle={onToggleSectionExpanded} />
            {section.expanded && section.items.length > 0 && (
              <div className="pb-1">
                {section.items.map((item) => (
                  <BrowserItemRow
                    key={item.id}
                    item={item}
                    depth={1}
                    selectedElementId={selectedElementId}
                    renamingNodeId={renamingNodeId}
                    onSelect={onSelectNode}
                    onToggleVisibility={onToggleVisibility}
                    onToggleExpanded={onToggleItemExpanded}
                    onContextMenu={handleContextMenu}
                    onStartRename={handleStartRename}
                    onFinishRename={handleFinishRename}
                    onCancelRename={handleCancelRename}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Empty state */}
        {!hasAnyItems && (
          <div className="px-4 py-6 text-gray-500 text-sm text-center">
            No features yet.
            <br />
            Create a sketch to get started.
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu.item && (
        <BrowserContextMenu
          visible={contextMenu.visible}
          x={contextMenu.x}
          y={contextMenu.y}
          nodeId={contextMenu.item.sourceNodeId ?? contextMenu.item.id}
          nodeLabel={contextMenu.item.label}
          nodeVisible={contextMenu.item.visible}
          onClose={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
          onRename={handleStartRename}
          onDelete={onDeleteNode}
          onToggleVisibility={onToggleVisibility}
        />
      )}
    </div>
  );
};

export default BrowserPanel;
