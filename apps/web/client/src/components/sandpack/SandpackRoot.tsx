import {
  SandpackProvider,
  SandpackLayout,
  SandpackPreview,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { useEffect, useRef } from "react";

interface SandpackStatusBridgeProps {
  onStatusChange?: (status: string) => void;
  onConsoleLog?: (message: string) => void;
}

/**
 * Inner component that lives inside SandpackProvider to access the useSandpack hook.
 * Bridges Sandpack status/events to the parent via callbacks.
 */
const SandpackStatusBridge = ({ onStatusChange, onConsoleLog }: SandpackStatusBridgeProps) => {
  const { sandpack, listen } = useSandpack();
  const prevStatus = useRef(sandpack.status);

  // Forward status changes (idle, running, etc.)
  useEffect(() => {
    if (sandpack.status !== prevStatus.current) {
      prevStatus.current = sandpack.status;
      onStatusChange?.(sandpack.status);
    }
  }, [sandpack.status, onStatusChange]);

  // Listen for console messages from the Sandpack client
  useEffect(() => {
    if (!onConsoleLog) return;

    const unsubscribe = listen((message) => {
      if (message.type === "console" && message.log) {
        const logs = Array.isArray(message.log) ? message.log : [message.log];
        for (const log of logs) {
          if (log.data) {
            const text = Array.isArray(log.data) ? log.data.join(" ") : String(log.data);
            onConsoleLog(text);
          }
        }
      }
    });

    return unsubscribe;
  }, [listen, onConsoleLog]);

  return null;
};

/**
 * Bridge component that pushes file updates into SandpackProvider's internal bundler.
 * SandpackProvider only reads the `files` prop on initial mount — subsequent changes
 * must be pushed via `sandpack.updateFile()`.
 */
const SandpackFileSyncer = ({ files }: { files: Record<string, string> }) => {
  const { sandpack } = useSandpack();
  const prevFilesRef = useRef<Record<string, string>>(files);

  useEffect(() => {
    const prevFiles = prevFilesRef.current;

    // Update changed / new files
    for (const [path, content] of Object.entries(files)) {
      if (prevFiles[path] !== content) {
        sandpack.updateFile(path, content);
      }
    }

    // Delete removed files
    for (const path of Object.keys(prevFiles)) {
      if (!(path in files)) {
        sandpack.deleteFile(path);
      }
    }

    prevFilesRef.current = { ...files };
  }, [files, sandpack]);

  return null;
};

interface SandpackRootProps {
  files: Record<string, string>;
  dependencies?: Record<string, string>;
  onStatusChange?: (status: string) => void;
  onConsoleLog?: (message: string) => void;
}

export const SandpackRoot = ({
  files,
  dependencies,
  onStatusChange,
  onConsoleLog,
}: SandpackRootProps) => {
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
      <SandpackProvider
        template="react"
        files={files}
        customSetup={
          dependencies && Object.keys(dependencies).length > 0
            ? { dependencies }
            : undefined
        }
        options={{
          initMode: "user-visible",
          initModeObserverOptions: { rootMargin: "1000px 0px" },
        }}
      >
        <SandpackFileSyncer files={files} />
        <SandpackStatusBridge
          onStatusChange={onStatusChange}
          onConsoleLog={onConsoleLog}
        />
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
