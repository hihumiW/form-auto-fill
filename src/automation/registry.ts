import { TriggerType } from "@/types";
import { Workflow } from "@/src/automation/types";
import { applyFormWorkflow } from "@/src/workflows/apply-form";
import { oralArchiveWorkflow } from "@/src/workflows/oral-archive";
import { oralAuditWorkflow } from "@/src/workflows/oral-audit";
import { oralCaseWorkflow } from "@/src/workflows/oral-case";

// 注册 popup 触发类型与具体业务流程的映射关系。
export const workflowRegistry = {
  applyForm: applyFormWorkflow,
  oralCase: oralCaseWorkflow,
  oralArchive: oralArchiveWorkflow,
  oralAudit: oralAuditWorkflow,
} satisfies Record<TriggerType, Workflow>;
