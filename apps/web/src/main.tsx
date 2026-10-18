import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./dashboard/Dashboard";
import "./style.css";
const OperatorApp = lazy(() => import("./OperatorApp"));
const params = new URLSearchParams(window.location.search);
const operator = params.get("legacy") === "1";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {operator ? (
      <Suspense fallback={<p role="status">Loading operator sign-in…</p>}>
        <OperatorApp />
      </Suspense>
    ) : (
      <Dashboard />
    )}
  </StrictMode>,
);
