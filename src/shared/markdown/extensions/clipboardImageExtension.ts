/* ── Clipboard Image Extension ───────────────────────────────────────
   CodeMirror 6 extension for intercepting image paste and drop events.

   Detects image/* items in clipboard or drag events and invokes a
   callback so the consuming component can upload + insert markdown.
   ──────────────────────────────────────────────────────────────────── */

import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// ── Config ──────────────────────────────────────────────────────────

export interface ClipboardImageConfig {
  /** Called when an image file is pasted or dropped. */
  onImagePaste: (file: File, view: EditorView) => Promise<void>;
}

// ── Extension entry point ───────────────────────────────────────────

export function buildClipboardImageExtension(config: ClipboardImageConfig): Extension {
  const { onImagePaste } = config;

  return [
    EditorView.domEventHandlers({
      paste(event: ClipboardEvent, view: EditorView) {
        const items = event.clipboardData?.items;
        if (!items) return false;

        for (const item of items) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              void onImagePaste(file, view);
              return true;
            }
          }
        }
        return false;
      },

      drop(event: DragEvent, view: EditorView) {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;

        const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
        if (imageFiles.length === 0) return false;

        event.preventDefault();

        // Move cursor to drop position
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos !== null) {
          view.dispatch({ selection: { anchor: pos } });
        }

        // Process each image file
        for (const file of imageFiles) {
          void onImagePaste(file, view);
        }
        return true;
      },

      dragover(event: DragEvent, view: EditorView) {
        // Check if drag contains image files
        const hasImage = event.dataTransfer?.types.includes("Files");
        if (!hasImage) return false;

        event.preventDefault();
        view.dom.closest(".shared-md-editor-shell")?.classList.add("shared-md-image-drop-active");
        return false; // Don't consume — let CM handle cursor
      },

      dragleave(event: DragEvent, view: EditorView) {
        const shell = view.dom.closest(".shared-md-editor-shell");
        if (!shell) return false;

        // Only remove if actually leaving the shell (not entering a child)
        const related = event.relatedTarget as Node | null;
        if (related && shell.contains(related)) return false;

        shell.classList.remove("shared-md-image-drop-active");
        return false;
      },
    }),

    // Remove drop indicator on any doc change (successful drop handled)
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        update.view.dom
          .closest(".shared-md-editor-shell")
          ?.classList.remove("shared-md-image-drop-active");
      }
    }),
  ];
}
