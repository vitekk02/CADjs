import React, { useState, useEffect, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { OrbitIcon, PanIcon, ZoomIcon, FitAllIcon } from "./icons/BrowserIcons";

type NavTool = "orbit" | "pan" | "zoom";

interface NavigationBarProps {
  controlsRef: React.MutableRefObject<OrbitControls | null>;
  navToolActiveRef: React.MutableRefObject<boolean>;
  onFitAll: () => void;
}

const NAV_TOOL_MOUSE: Record<NavTool, THREE.MOUSE> = {
  orbit: THREE.MOUSE.ROTATE,
  pan: THREE.MOUSE.PAN,
  zoom: THREE.MOUSE.DOLLY,
};

const NAV_TOOL_CURSOR: Record<NavTool, string> = {
  orbit: "grab",
  pan: "move",
  zoom: "ns-resize",
};

const NavigationBar: React.FC<NavigationBarProps> = ({
  controlsRef,
  navToolActiveRef,
  onFitAll,
}) => {
  const [activeTool, setActiveTool] = useState<NavTool | null>(null);

  const deactivate = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.mouseButtons.LEFT = null as any;
      const canvas = controlsRef.current.domElement as HTMLElement;
      canvas.style.cursor = "";
    }
    navToolActiveRef.current = false;
    setActiveTool(null);
  }, [controlsRef, navToolActiveRef]);

  const activate = useCallback(
    (tool: NavTool) => {
      if (controlsRef.current) {
        controlsRef.current.mouseButtons.LEFT = NAV_TOOL_MOUSE[tool];
        const canvas = controlsRef.current.domElement as HTMLElement;
        canvas.style.cursor = NAV_TOOL_CURSOR[tool];
      }
      navToolActiveRef.current = true;
      setActiveTool(tool);
    },
    [controlsRef, navToolActiveRef],
  );

  const handleToggle = useCallback(
    (tool: NavTool) => {
      if (activeTool === tool) {
        deactivate();
      } else {
        activate(tool);
      }
    },
    [activeTool, activate, deactivate],
  );

  // Escape and right-click deactivation
  useEffect(() => {
    if (!activeTool) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        deactivate();
      }
    };
    const handleContextMenu = () => {
      deactivate();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [activeTool, deactivate]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      navToolActiveRef.current = false;
    };
  }, [navToolActiveRef]);

  const btnClass = (tool: NavTool) =>
    `p-1.5 rounded transition-colors ${
      activeTool === tool
        ? "bg-blue-600 text-white"
        : "text-gray-300 hover:bg-gray-600 hover:text-white"
    }`;

  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-gray-800 bg-opacity-90 border border-gray-600 rounded-lg px-1.5 py-1">
      <button
        className={btnClass("orbit")}
        onClick={() => handleToggle("orbit")}
        title="Orbit (Alt+Left-click)"
      >
        <OrbitIcon className="w-4 h-4" />
      </button>
      <button
        className={btnClass("pan")}
        onClick={() => handleToggle("pan")}
        title="Pan"
      >
        <PanIcon className="w-4 h-4" />
      </button>
      <button
        className={btnClass("zoom")}
        onClick={() => handleToggle("zoom")}
        title="Zoom"
      >
        <ZoomIcon className="w-4 h-4" />
      </button>
      <div className="w-px h-5 bg-gray-600 mx-0.5" />
      <button
        className="p-1.5 rounded text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
        onClick={onFitAll}
        title="Fit All (F)"
      >
        <FitAllIcon className="w-4 h-4" />
      </button>
    </div>
  );
};

export default NavigationBar;
