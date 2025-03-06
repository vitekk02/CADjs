import React from "react";
import { createRoot } from "react-dom/client";
// import "./index.css";
import CubeScene from "./cubeScene";
import SkicScene from "./skicScene";
import Navbar from "../src/navbar/navbar";
const App = () => {
  const [mode, setMode] = React.useState<"draw" | "move" | "union">("draw");

  return (
    <div>
      <Navbar mode={mode} setMode={setMode} />
      {/* <CubeScene /> */}
      <SkicScene mode={mode} />
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
