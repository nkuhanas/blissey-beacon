import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./dashboard/Dashboard";
import "./style.css";
const OperatorApp = lazy(() => import("./OperatorApp"));
const demo = new URLSearchParams(window.location.search).get("demo") === "1";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {demo ? (
      <Dashboard />
    ) : (
      <Suspense fallback={<p role="status">Loading operator sign-in…</p>}>
        <OperatorApp />
      </Suspense>
    )}
  </StrictMode>,
);
