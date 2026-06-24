import { AutomationContext, Workflow } from "@/src/automation/types";
import { showNotice } from "@/src/browser/notice";
import { wait, waitUntil } from "@/src/browser/dom";
import {
  openFirstOralCaseForArchive,
  returnToOralCaseList,
} from "@/src/workflows/oral-case/list-page";
import {
  isElectronicArchiveCompleted,
  isElectronicArchivePending,
  runOneClickElectronicArchiveFlow,
  validateOralArchivePrerequisites,
} from "@/src/workflows/oral-case/detail-page";

async function waitForOralCaseDetailReady(): Promise<void> {
  await waitUntil("等待口头案件详情加载完成", () => {
    const caseHeader = document.querySelector<HTMLDivElement>(".case-info-header");
    return (
      Boolean(caseHeader?.textContent?.includes("正在办理")) &&
      Boolean(document.querySelector(".case-steps-container .step-item"))
    );
  });
}

async function archiveOneOralCase(
  caseNumber: string,
  context: AutomationContext
): Promise<"archived" | "skipped"> {
  context.log(`开始归档口头案件：${caseNumber}`);

  await waitForOralCaseDetailReady();
  validateOralArchivePrerequisites();

  if (isElectronicArchiveCompleted()) {
    context.log(`电子卷宗已归档，跳过：${caseNumber}`);
    return "skipped";
  }

  if (!isElectronicArchivePending()) {
    throw new Error(`电子卷宗状态不是未归档，停止自动归档：${caseNumber}`);
  }

  await runOneClickElectronicArchiveFlow();
  context.log(`口头案件电子卷宗归档完成：${caseNumber}`);
  return "archived";
}

export const oralArchiveWorkflow: Workflow = {
  name: "自动归档口头案件",

  async run(context) {
    const attemptedCaseNumbers = new Set<string>();
    let archivedCount = 0;
    let skippedCount = 0;

    while (context.shouldContinue()) {
      const selection = await openFirstOralCaseForArchive(attemptedCaseNumbers);

      if (!selection) {
        context.log(
          `当前页没有未尝试的口头案件，自动归档结束。已归档 ${archivedCount} 件，跳过 ${skippedCount} 件`
        );
        showNotice(
          `自动归档结束：已归档 ${archivedCount} 件，跳过 ${skippedCount} 件`,
          "success"
        );
        return;
      }

      await wait(300);
      const result = await archiveOneOralCase(selection.caseNumber, context);

      if (result === "archived") {
        archivedCount += 1;
      } else {
        skippedCount += 1;
      }

      await returnToOralCaseList();
      showNotice(
        `口头案件归档进度：已归档 ${archivedCount} 件，跳过 ${skippedCount} 件`,
        "success"
      );
      await wait(1500);
    }
  },
};
