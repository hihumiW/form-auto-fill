import { Workflow } from "@/src/automation/types";
import { wait } from "@/src/browser/dom";
import { showNotice } from "@/src/browser/notice";
import { fillAcceptanceModal, saveAcceptanceModal } from "@/src/workflows/apply-form/acceptance-modal";
import { openFirstPendingApplyCase } from "@/src/workflows/apply-form/list-page";
import {
  openAcceptanceModal,
  returnToApplyList,
} from "@/src/workflows/apply-form/process-page";

// 定义当事人申请自动受理流程。
export const applyFormWorkflow: Workflow = {
  name: "当事人申请自动受理",

  async run(context) {
    let count = 0;

    // 循环处理列表中的待受理案件，直到没有数据或流程异常停止。
    while (context.shouldContinue()) {
      const caseNumber = await openFirstPendingApplyCase();
      context.log(`开始处理当事人申请：${caseNumber}`);

      // 按业务步骤依次处理详情页和受理弹窗。
      await openAcceptanceModal();
      await fillAcceptanceModal();
      await saveAcceptanceModal();
      await returnToApplyList();

      // 记录本轮完成状态。
      count += 1;
      context.log(`当事人申请处理完成：${caseNumber}`);
      context.log(`已处理当事人申请数量：${count}`);
      showNotice(`当事人申请处理完成：${caseNumber}，累计 ${count} 件`, "success");

      // 给列表刷新留出短暂缓冲，再进入下一轮。
      await wait(500);
    }
  },
};
