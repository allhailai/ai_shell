import { useCallback, useState, type SubmitEventHandler } from "react";
import { PackageFilePicker } from "../components/PackageFilePicker";
import { getPackageFileKind, isAcceptedPackageFile } from "../packageFile";
import type { PackageFileKind } from "../packageFile";

export interface CreateAssessmentPayload {
  productName: string;
  packageFile: {
    fileName: string;
    fileSize: number;
    kind: PackageFileKind;
  };
}

interface CreateAssessmentProps {
  onCancel: () => void;
  /** Stub in Phase 3 — full in-memory list lands in Phase 4. */
  onCreate: (payload: CreateAssessmentPayload) => void;
}

interface FieldErrors {
  productName?: string;
  packageFile?: string;
}

const PRODUCT_NAME_ID = "market-access-product-name";
const PRODUCT_NAME_ERROR_ID = "market-access-product-name-error";
const PACKAGE_FILE_ID = "market-access-package-file";
const PACKAGE_FILE_HINT_ID = "market-access-package-file-hint";

/** Dedicated create page — product name plus one package document. */
export function CreateAssessment({ onCancel, onCreate }: CreateAssessmentProps) {
  const [productName, setProductName] = useState("");
  const [packageFile, setPackageFile] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function validate(): FieldErrors | null {
    const errors: FieldErrors = {};
    if (!productName.trim()) {
      errors.productName = "Product or drug name is required.";
    }
    if (!packageFile) {
      errors.packageFile = "A package file is required.";
    } else if (!isAcceptedPackageFile(packageFile.name)) {
      errors.packageFile =
        "Use a Markdown (.md, .markdown) or Word (.docx) package file.";
    }
    return Object.keys(errors).length > 0 ? errors : null;
  }

  const handleSubmit = useCallback<SubmitEventHandler<HTMLFormElement>>(
    (e) => {
      e.preventDefault();
      const errors = validate();
      if (errors) {
        setFieldErrors(errors);
        return;
      }

      const kind = getPackageFileKind(packageFile!.name);
      if (!kind) {
        setFieldErrors({
          packageFile:
            "Use a Markdown (.md, .markdown) or Word (.docx) package file.",
        });
        return;
      }

      setFieldErrors({});
      onCreate({
        productName: productName.trim(),
        packageFile: {
          fileName: packageFile!.name,
          fileSize: packageFile!.size,
          kind,
        },
      });
    },
    [onCreate, packageFile, productName],
  );

  const handleProductNameChange = useCallback((value: string) => {
    setProductName(value);
    setFieldErrors((prev) => {
      if (!prev.productName) return prev;
      const next = { ...prev };
      delete next.productName;
      return next;
    });
  }, []);

  const handlePackageFileChange = useCallback((file: File | null) => {
    setPackageFile(file);
    setFieldErrors((prev) => {
      if (!prev.packageFile) return prev;
      const next = { ...prev };
      delete next.packageFile;
      return next;
    });
  }, []);

  return (
    <div
      className="market-access-page market-access-page-form"
      role="region"
      aria-labelledby="market-access-create-heading"
    >
      <header className="market-access-form-header">
        <h1 id="market-access-create-heading" className="market-access-title">
          Create assessment
        </h1>
        <p className="market-access-subtitle">
          Enter the product or drug name and attach one package document to
          start an analog assessment workspace.
        </p>
      </header>

      <form className="market-access-form" onSubmit={handleSubmit} noValidate>
        <div className="market-access-field">
          <label className="market-access-label" htmlFor={PRODUCT_NAME_ID}>
            Product or drug name
          </label>
          <input
            id={PRODUCT_NAME_ID}
            className="market-access-input"
            type="text"
            value={productName}
            onChange={(e) => handleProductNameChange(e.target.value)}
            placeholder="e.g., Onpattro (patisiran)"
            autoFocus
            aria-invalid={fieldErrors.productName ? true : undefined}
            aria-describedby={
              fieldErrors.productName ? PRODUCT_NAME_ERROR_ID : undefined
            }
          />
          {fieldErrors.productName ? (
            <div
              id={PRODUCT_NAME_ERROR_ID}
              className="market-access-field-error"
              role="alert"
            >
              {fieldErrors.productName}
            </div>
          ) : null}
        </div>

        <div className="market-access-field">
          <label className="market-access-label" htmlFor={PACKAGE_FILE_ID}>
            Package file
          </label>
          <PackageFilePicker
            file={packageFile}
            onFileChange={handlePackageFileChange}
            error={fieldErrors.packageFile ?? null}
            inputId={PACKAGE_FILE_ID}
            describedById={PACKAGE_FILE_HINT_ID}
          />
        </div>

        <div className="market-access-form-actions">
          <button
            type="button"
            className="market-access-btn market-access-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="market-access-btn market-access-btn-primary"
          >
            Create assessment
          </button>
        </div>
      </form>
    </div>
  );
}
