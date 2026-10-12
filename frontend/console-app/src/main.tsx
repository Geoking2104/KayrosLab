import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConsoleApp } from "./components/console/Shell";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConsoleApp />
  </StrictMode>,
);
