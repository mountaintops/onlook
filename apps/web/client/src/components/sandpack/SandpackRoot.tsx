import { SandpackProvider, SandpackLayout, SandpackPreview } from "@codesandbox/sandpack-react";

export const SandpackRoot = ({ files }: { files: Record<string, string> }) => {
  return (
    <div className="h-full w-full">
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
