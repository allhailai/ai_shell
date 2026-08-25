import { useCallback, useRef, useState } from "react";
import { IconUpload } from "./MarketAccessIcons";
import {
  PACKAGE_FILE_ACCEPT,
  isAcceptedPackageFile,
  packageFileRejectionMessage,
} from "../packageFile";

interface PackageFilePickerProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** Field-level error from form validation (shown below the zone). */
  error?: string | null;
  inputId: string;
  describedById: string;
}

/**
 * Click + drop zone for one package document. Selection stays in form state —
 * no upload or filesystem path (PR 2+).
 */
export function PackageFilePicker({
  file,
  onFileChange,
  error,
  inputId,
  describedById,
}: PackageFilePickerProps) {
  const [dragOver, setDragOver] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyFile = useCallback(
    (candidate: File) => {
      if (!isAcceptedPackageFile(candidate.name)) {
        setPickError(packageFileRejectionMessage(candidate.name));
        return;
      }
      setPickError(null);
      onFileChange(candidate);
    },
    [onFileChange],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) applyFile(files[0]);
    },
    [applyFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) applyFile(files[0]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [applyFile],
  );

  const handleClickZone = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClickZone();
      }
    },
    [handleClickZone],
  );

  const displayError = error ?? pickError;

  return (
    <div className="market-access-file-picker">
      <div
        className={`market-access-file-picker-zone${dragOver ? " market-access-file-picker-zone-dragover" : ""}${file ? " market-access-file-picker-zone-selected" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClickZone}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-describedby={describedById}
      >
        <span aria-hidden>
          <IconUpload size={24} />
        </span>
        {file ? (
          <span className="market-access-file-picker-selected">{file.name}</span>
        ) : (
          <span className="market-access-file-picker-text">
            Drop a package file here or click to browse
          </span>
        )}
        <span
          id={describedById}
          className={
            file
              ? "market-access-file-picker-hint market-access-sr-only"
              : "market-access-file-picker-hint"
          }
        >
          Markdown (.md, .markdown) or Word (.docx)
        </span>
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept={PACKAGE_FILE_ACCEPT}
          onChange={handleFileSelect}
          className="market-access-file-picker-input"
          tabIndex={-1}
        />
      </div>
      {displayError ? (
        <div className="market-access-field-error" role="alert">
          {displayError}
        </div>
      ) : null}
    </div>
  );
}
