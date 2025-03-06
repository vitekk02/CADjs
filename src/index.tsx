// src/index.tsx
import React from "react";
import { createRoot } from "react-dom/client";

const App = () => <div>Hello, CAD Package!</div>;

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
