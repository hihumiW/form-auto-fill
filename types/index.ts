export type TriggerType = "applyForm" | "oralCase" | "oralArchive" | "oralAudit";
export type BackgroundAction = "openMobileSignPage";
export type SignatureMode = "manual" | "auto";
export type AutoSignatureMode = "hanzi-medians";
export type HanziMedian = Array<[number, number]>;

export interface HanziData {
  medians: HanziMedian[];
}

export interface SignatureMedianEntry {
  name: string;
  chars: string[];
  dataByChar: Record<string, HanziData>;
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
  signatureMedians?: SignatureMedianEntry[];
}
