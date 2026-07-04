/* ── CodaScope: ArtifactPreview ───────────────────────────────────────
   Sandboxed iframe preview for built HTML artifacts.
   Manages the postMessage bridge for annotation mode, scroll-to-section,
   and element highlighting.
   ──────────────────────────────────────────────────────────────────── */

import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import type { ArtifactElementContext } from "../../codaScopeTypes.js";

interface ArtifactPreviewProps {
  previewSrc: string;
  /** Increment to force-reload the iframe */
  reloadKey: number;
  /** Called when user clicks an element in annotation mode */
  onAnnotationSelected: (data: {
    sectionId: string;
    sectionTitle: string;
    elementContext: ArtifactElementContext;
  }) => void;
}

export interface ArtifactPreviewHandle {
  enterAnnotationMode: () => void;
  exitAnnotationMode: () => void;
  scrollToSection: (sectionId: string) => void;
  highlightElement: (cssPath: string, sectionId?: string) => void;
  pauseHover: () => void;
  resumeHover: () => void;
}

export const ArtifactPreview = forwardRef<ArtifactPreviewHandle, ArtifactPreviewProps>(
  function ArtifactPreview({ previewSrc, reloadKey, onAnnotationSelected }, ref) {
    const iframeRef = useRef<HTMLIFrameElement>(null);

    const postToIframe = useCallback(
      (message: Record<string, unknown>) => {
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow) return;
        iframe.contentWindow.postMessage(message, "*");
      },
      [],
    );

    // Expose imperative methods to parent
    useImperativeHandle(
      ref,
      () => ({
        enterAnnotationMode: () =>
          postToIframe({ type: "enter-annotation-mode" }),
        exitAnnotationMode: () =>
          postToIframe({ type: "exit-annotation-mode" }),
        scrollToSection: (sectionId: string) =>
          postToIframe({ type: "scroll-to-section", sectionId }),
        highlightElement: (cssPath: string, sectionId?: string) =>
          postToIframe({ type: "highlight-element", cssPath, sectionId }),
        pauseHover: () =>
          postToIframe({ type: "pause-hover" }),
        resumeHover: () =>
          postToIframe({ type: "resume-hover" }),
      }),
      [postToIframe],
    );

    // Listen for annotation-selected messages from the iframe
    useEffect(() => {
      function handleMessage(event: MessageEvent) {
        if (event.data?.type !== "annotation-selected") return;
        const {
          sectionId,
          elementTag,
          elementId,
          cssPath,
          elementText,
          elementHTML,
        } = event.data.payload ?? event.data;

        if (!sectionId) return;

        onAnnotationSelected({
          sectionId,
          sectionTitle: sectionId, // will be resolved by parent
          elementContext: {
            elementTag: elementTag ?? "UNKNOWN",
            elementId: elementId || undefined,
            cssPath: cssPath || undefined,
            elementText: elementText || undefined,
            elementHTML: elementHTML || undefined,
          },
        });
      }

      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }, [onAnnotationSelected]);

    return (
      <div className="codascope-artifact-preview-container">
        <iframe
          ref={iframeRef}
          key={reloadKey}
          className="codascope-artifact-preview-iframe"
          src={previewSrc}
          sandbox="allow-scripts allow-same-origin"
          title="Artifact Preview"
        />
      </div>
    );
  },
);
