import { TriggerType } from "@/types";
import { Workflow } from "@/src/automation/types";
import { applyFormWorkflow } from "@/src/workflows/apply-form";
import { ktFormWorkflow } from "@/src/workflows/kt-form";

// 注册 popup 触发类型与具体业务流程的映射关系。
export const workflowRegistry = {
  applyForm: applyFormWorkflow,
  ktForm: ktFormWorkflow,
} satisfies Record<TriggerType, Workflow>;
