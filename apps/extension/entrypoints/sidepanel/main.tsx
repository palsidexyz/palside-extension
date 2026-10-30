import React from "react";
import ReactDOM from "react-dom/client";
import { LiveApp } from "../../src/features/palside/app/live-app";
import "@palside/design/fonts.css";
import "../../src/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Palside root element is missing");
ReactDOM.createRoot(root).render(<React.StrictMode><LiveApp /></React.StrictMode>);
