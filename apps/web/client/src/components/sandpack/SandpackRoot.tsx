import { SandpackProvider, SandpackLayout, SandpackPreview } from "@codesandbox/sandpack-react";

export const SandpackRoot = ({ files }: { files: Record<string, string> }) => {
  return (
    <div className="sandpack-container" style={{ height: "100%", width: "100%" }}>
      <style>{`
        .sandpack-container,
        .sandpack-container .sp-wrapper,
        .sandpack-container .sp-layout,
        .sandpack-container .sp-stack,
        .sandpack-container .sp-preview-container,
        .sandpack-container .sp-preview-iframe,
        .sandpack-container .sp-preview-actions-container {
          height: 100% !important;
          width: 100% !important;
          max-height: 100% !important;
        }
        .sandpack-container .sp-layout {
          border: none !important;
          border-radius: 0 !important;
        }
        .sandpack-container .sp-preview-iframe {
          border: none !important;
        }
      `}</style>
      <SandpackProvider template="react" files={files} options={{
        initMode: "user-visible",
        initModeObserverOptions: { rootMargin: "1000px 0px" },
      }}>
        <SandpackLayout style={{ height: "100%", width: "100%", border: "none" }}>
          <SandpackPreview
            showNavigator={false}
            showOpenInCodeSandbox={false}
            showRefreshButton={false}
            style={{ height: "100%", width: "100%" }}
          />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );
};
