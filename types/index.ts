export type TriggerType = "applyForm"  | "oralCase";
export type BackgroundAction = "openMobileSignPage";
export type SignatureMode = "manual" | "auto";
export type AutoSignatureMode = "skeleton-strokes";

export interface SignatureFontConfig {
  name: string;
  path: string;
}

export interface SkeletonSignatureConfig {
  fontSize: number;
  scaleX: number;
  slant: number;
  sampleDensity: number;
  jitter: number;
}

export interface ResponseResult<T = null> {
  success: boolean;
  data: T;
  errorMessage?: string;
}

export interface RequestAction<T = null> {
  action: string;
  data: T;
}

export interface OpenMobileSignPagePayload {
  url: string;
  signatureMode?: SignatureMode;
  autoSignatureMode?: AutoSignatureMode;
  signatureNames?: string[];
  signatureFonts?: SignatureFontConfig[];
  skeletonConfig?: SkeletonSignatureConfig;
}
