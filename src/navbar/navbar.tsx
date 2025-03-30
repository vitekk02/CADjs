// src/navbar/navbar.tsx
import React, { FC, useState } from "react";
import { useScene, SceneMode } from "../contexts/SceneContext";

const Navbar: FC = () => {
  const { mode, setMode, currentShape, setCurrentShape } = useScene();
  const [activeMenu, setActiveMenu] = useState<"operations" | "create" | null>(
    null
  );

  const toggleMenu = (menu: "operations" | "create") => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  return (
    <div className="relative z-50">
      <nav className="bg-gray-900 border-b border-gray-700 text-white px-4 py-3 flex justify-start items-center shadow-md space-x-6">
        <div className="relative">
          <button
            onClick={() => toggleMenu("operations")}
            className="px-4 py-2 rounded hover:bg-gray-800 focus:outline-none transition"
          >
            Operations
          </button>
          {activeMenu === "operations" && (
            <div
              className="absolute left-0 top-full mt-1 bg-gray-800 text-white px-4 py-2 shadow-md rounded z-50"
              style={{ minWidth: "200px" }}
            >
              <div className="flex flex-col">
                <button
                  onClick={() => {
                    setMode("draw");
                    setActiveMenu(null);
                  }}
                  className={`px-4 py-2 rounded hover:bg-gray-700 focus:outline-none transition ${
                    mode === "draw" ? "bg-gray-700" : ""
                  }`}
                >
                  Draw Sketches
                </button>
                <button
                  onClick={() => {
                    setMode("move");
                    setActiveMenu(null);
                  }}
                  className={`px-4 py-2 rounded hover:bg-gray-700 focus:outline-none transition ${
                    mode === "move" ? "bg-gray-700" : ""
                  }`}
                >
                  Move Sketches
                </button>
                <button
                  onClick={() => {
                    setMode("union");
                    setActiveMenu(null);
                  }}
                  className={`px-4 py-2 rounded hover:bg-gray-700 focus:outline-none transition ${
                    mode === "union" ? "bg-gray-700" : ""
                  }`}
                >
                  Union
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => toggleMenu("create")}
            className="px-4 py-2 rounded hover:bg-gray-800 focus:outline-none transition"
          >
            Create
          </button>
          {activeMenu === "create" && (
            <div
              className="absolute left-0 top-full mt-1 bg-gray-800 text-white px-4 py-2 shadow-md rounded z-50"
              style={{ minWidth: "200px" }}
            >
              <ul className="flex flex-col">
                <li
                  onClick={() => setCurrentShape("rectangle")}
                  className={`px-4 py-2 hover:bg-gray-700 cursor-pointer ${
                    currentShape === "rectangle" ? "bg-gray-700" : ""
                  }`}
                >
                  Create Rectangle
                </li>
                <li
                  onClick={() => setCurrentShape("circle")}
                  className={`px-4 py-2 hover:bg-gray-700 cursor-pointer ${
                    currentShape === "circle" ? "bg-gray-700" : ""
                  }`}
                >
                  Create Circle
                </li>
                <li
                  onClick={() => setCurrentShape("triangle")}
                  className={`px-4 py-2 hover:bg-gray-700 cursor-pointer ${
                    currentShape === "triangle" ? "bg-gray-700" : ""
                  }`}
                >
                  Create Triangle
                </li>
              </ul>
            </div>
          )}
        </div>

        {/* Display current mode indicator */}
        <div className="ml-auto px-4 py-2 bg-gray-800 rounded">
          Mode: {mode.charAt(0).toUpperCase() + mode.slice(1)}
        </div>
      </nav>
    </div>
  );
};

export default Navbar;
