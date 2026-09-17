/** UK legal domain helpers and public resource types. */
export type LegalResourceCategory =
  "immigration" | "asylum" | "employment" | "tribunal" | "modern_slavery" | "guidance" | "rights";

export interface PublicLegalLink {
  title: string;
  url: string;
  publisher: string;
  category: LegalResourceCategory;
}
