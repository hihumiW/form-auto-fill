export type TriggerType = "applyForm"  | "oralCase";
export type BackgroundAction = "openMobileSignPage";
export type SignatureMode = "manual" | "auto";

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
}
