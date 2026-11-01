import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// typing in a number box replaces what is there, so nobody has to delete a 0 first
document.addEventListener("focusin", (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement && t.type === "number") t.select();
});
