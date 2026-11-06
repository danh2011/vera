import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { Providers } from "./context";
import { App } from "./App";
import "@fontsource-variable/geist";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<StrictMode><Providers><HashRouter><App /></HashRouter></Providers></StrictMode>);
