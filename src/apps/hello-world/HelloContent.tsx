import { useSyncExternalStore } from "react";
import { HelloPage } from "./HelloPage";
import { AboutPage } from "./AboutPage";

/**
 * Hello World main content — handles internal sub-routing.
 * Renders the correct sub-page based on the URL path.
 */
export function HelloContent() {
  const subPath = useSyncExternalStore(subscribeToPath, getSubPath, getSubPath);

  switch (subPath) {
    case "about":
      return <AboutPage />;
    default:
      return <HelloPage />;
  }
}

function getSubPath(): string {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments.slice(1).join("/");
}

function subscribeToPath(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}
