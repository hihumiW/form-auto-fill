export type TriggerType = "applyForm" | "ktForm";

export interface ResponseResult<T = null> {
  success: boolean;
  data: T;
  errorMessage?: string;
}

export interface RequestAction<T = null> {
  action: string;
  data: T;
}
