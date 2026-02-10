export const DEFAULT_FILES = {
    "/App.js": `import React from "react";

export default function App() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.4", padding: "20px" }}>
      <h1>Hello from Onlook (Client-Side)</h1>
      <p>
        Your project files are being synchronized. If you see this message, 
        it means the local cache was empty and we are waiting for the initial sync 
        from the CodeSandbox VM.
      </p>
      <p>
        Once the sync is complete, your project will appear here automatically.
      </p>
    </div>
  );
}
`,
    "/index.js": `import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import App from "./App";

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);`,
    "/styles.css": `body {
  font-family: sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  margin: 0;
  padding: 0;
}`
};
