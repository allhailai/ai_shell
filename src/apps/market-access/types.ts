import type { PackageFormat } from "./packageFile";

/** Package document metadata stored on create — not the File blob or a filesystem path. */
export interface PackageFileMetadata {
  fileName: string;
  fileSize: number;
  format: PackageFormat;
}

/** In-memory assessment view-model for one product/asset workspace. */
export interface Assessment {
  id: string;
  productName: string;
  packageFile: PackageFileMetadata;
  /** Epoch ms — used for same-session list ordering only. */
  createdAt: number;
}

/** Payload from the create form before an id is assigned. */
export type CreateAssessmentInput = Pick<Assessment, "productName" | "packageFile">;
