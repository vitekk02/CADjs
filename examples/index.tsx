import React from "react";
import { createRoot } from "react-dom/client";
// import "./index.css";
import CubeScene from "./cubeScene";
import SkicScene from "./skicScene";
import Navbar from "../src/navbar/navbar";
import { SceneProvider } from "../src/contexts/SceneContext";
import { CadCoreProvider } from "../src/contexts/CoreContext";
import { CadVisualizerProvider } from "../src/contexts/VisualizerContext";
import SimpleCadScene from "./simpleCadScene";
const App = () => {
  return (
    <CadCoreProvider>
      <CadVisualizerProvider>
        <SimpleCadScene />
      </CadVisualizerProvider>
    </CadCoreProvider>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
