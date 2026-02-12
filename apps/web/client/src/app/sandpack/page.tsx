import { SandpackRoot } from "@/components/sandpack/SandpackRoot";

const FILES = {
  "/App.js": {
    code: `export default function App() {
  return <h1>Hello World from Sandpack</h1>
}`
  },
  "/index.js": {
    code: `import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import App from "./App";

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);`
  },
  "/styles.css": {
    code: `body {
  font-family: sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  margin: 0;
  padding: 0;
}

h1 {
  font-size: 1.5rem;
}`
  }
};

export default function SandpackPage() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-4xl p-4">
        <h1 className="text-2xl font-bold mb-4">Sandpack Hello World</h1>
        <SandpackRoot files={FILES} />
      </div>
    </div>
  );
}
