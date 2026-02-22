import React, { FC } from "react";
import { FeatureNode } from "../types/sketch-types";

interface FeatureTreeProps {
  nodes: FeatureNode[];
  onToggleVisibility: (nodeId: string) => void;
  onToggleExpanded: (nodeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
  selectedNodeId?: string;
}

interface TreeNodeProps {
  node: FeatureNode;
  depth: number;
  onToggleVisibility: (nodeId: string) => void;
  onToggleExpanded: (nodeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
  selectedNodeId?: string;
}

const getNodeIcon = (type: FeatureNode["type"]): string => {
  switch (type) {
    case "sketch":
      return "\uD83D\uDCD0"; // Triangular ruler
    case "profile":
      return "\u25FB"; // White square
    case "body":
      return "\uD83E\uDDF1"; // Brick/cube
    case "folder":
      return "\uD83D\uDCC1"; // Folder
    default:
      return "\u25CF"; // Circle
  }
};

const TreeNode: FC<TreeNodeProps> = ({
  node,
  depth,
  onToggleVisibility,
  onToggleExpanded,
  onSelectNode,
  selectedNodeId,
}) => {
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedNodeId === node.id;

  const handleVisibilityClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleVisibility(node.id);
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) {
      onToggleExpanded(node.id);
    }
  };

  const handleRowClick = () => {
    if (onSelectNode) {
      onSelectNode(node.id);
    }
  };

  return (
    <div>
      <div
        className={`flex items-center py-1 px-1 hover:bg-gray-700 cursor-pointer rounded ${
          isSelected ? "bg-blue-900" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={handleRowClick}
      >
        {/* Expand/collapse button */}
        <button
          onClick={handleExpandClick}
          className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-white mr-1"
        >
          {hasChildren ? (
            node.expanded ? (
              <span className="text-xs">\u25BC</span>
            ) : (
              <span className="text-xs">\u25B6</span>
            )
          ) : (
            <span className="w-4"></span>
          )}
        </button>

        {/* Visibility toggle */}
        <button
          onClick={handleVisibilityClick}
          className={`w-5 h-5 flex items-center justify-center rounded mr-1 ${
            node.visible
              ? "text-blue-400 hover:text-blue-300"
              : "text-gray-600 hover:text-gray-500"
          }`}
          title={node.visible ? "Hide" : "Show"}
        >
          {node.visible ? "\uD83D\uDC41" : "\u2014"}
        </button>

        {/* Icon */}
        <span className="mr-2 text-sm">{getNodeIcon(node.type)}</span>

        {/* Name */}
        <span
          className={`text-sm truncate ${
            node.visible ? "text-gray-200" : "text-gray-500"
          }`}
        >
          {node.name}
        </span>
      </div>

      {/* Children */}
      {hasChildren && node.expanded && (
        <div>
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onToggleVisibility={onToggleVisibility}
              onToggleExpanded={onToggleExpanded}
              onSelectNode={onSelectNode}
              selectedNodeId={selectedNodeId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FeatureTree: FC<FeatureTreeProps> = ({
  nodes,
  onToggleVisibility,
  onToggleExpanded,
  onSelectNode,
  selectedNodeId,
}) => {
  if (nodes.length === 0) {
    return (
      <div className="p-4 text-gray-500 text-sm text-center">
        No features yet.
        <br />
        Create a sketch to get started.
      </div>
    );
  }

  return (
    <div className="py-1">
      {nodes.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          onToggleVisibility={onToggleVisibility}
          onToggleExpanded={onToggleExpanded}
          onSelectNode={onSelectNode}
          selectedNodeId={selectedNodeId}
        />
      ))}
    </div>
  );
};

export default FeatureTree;
