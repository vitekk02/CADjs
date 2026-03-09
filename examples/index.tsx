import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CadCoreProvider } from "../src/contexts/CoreContext";
import { CadVisualizerProvider } from "../src/contexts/VisualizerContext";
import { ToastProvider } from "../src/contexts/ToastContext";
import { OccWorkerClient } from "../src/services/OccWorkerClient";
import { SketchSolverService } from "../src/services/SketchSolverService";
import LoadingScreen from "../src/components/LoadingScreen";
import SimpleCadScene from "./simpleCadScene";

type LoadState = "loading" | "ready" | "error";

const AppLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const initialize = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      await Promise.all([
        OccWorkerClient.getInstance().waitForReady(),
        SketchSolverService.getInstance().getGCS(),
      ]);
      setState("ready");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleRetry = useCallback(() => {
    OccWorkerClient.getInstance().dispose();
    SketchSolverService.getInstance().resetInit();
    initialize();
  }, [initialize]);

  if (state !== "ready") {
    return (
      <LoadingScreen
        error={state === "error" ? error : null}
        onRetry={handleRetry}
      />
    );
  }

  return <>{children}</>;
};

const App = () => {
  return (
    <AppLoader>
      <ToastProvider>
        <CadCoreProvider>
          <CadVisualizerProvider>
            <SimpleCadScene />
          </CadVisualizerProvider>
        </CadCoreProvider>
      </ToastProvider>
    </AppLoader>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
