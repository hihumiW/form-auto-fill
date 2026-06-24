import { AutomationContext, Workflow } from "@/src/automation/types";
import { showNotice } from "@/src/browser/notice";
import {
  openFirstOralCase,
  returnToOralCaseList,
} from "@/src/workflows/oral-case/list-page";
import {
  fillProtocolRegisterForm,
  isProtocolRegisterPending,
  openProtocolRegisterForm,
  runArchiveFlow,
  runSealFlow,
  runSignatureFlow,
  saveProtocolRegisterForm,
} from "@/src/workflows/oral-case/detail-page";
import { wait, waitUntil } from "@/src/browser/dom";

async function ensureProtocolRegisterForm(
  caseNumber: string,
  context: AutomationContext
): Promise<void> {
  if (!isProtocolRegisterPending()) {
    context.log(`口头协议登记表已录入，跳过填写：${caseNumber}`);
    await wait(500);
    return 
  }

  await openProtocolRegisterForm();
  await fillProtocolRegisterForm();
  await saveProtocolRegisterForm();

  context.log(`口头协议登记表录入完成：${caseNumber}`);
}

async function processOneOralCase(
  caseNumber: string,
  signatureNames: string[],
  context: AutomationContext
): Promise<void> {
  context.log(`开始处理口头案件：${caseNumber}`);

  await waitUntil('等待口头案件详情加载完成', () => {
      const caseHeader = document.querySelector<HTMLDivElement>('.case-info-header');
      console.log(caseHeader?.textContent)
      return !!caseHeader?.textContent.includes('正在办理')
  })


  await ensureProtocolRegisterForm(caseNumber, context);

  await runSignatureFlow(signatureNames);
  context.log(`口头案件签字完成：${caseNumber}`);

  await runSealFlow();
  context.log(`口头案件签章完成：${caseNumber}`);

  await runArchiveFlow();
  context.log(`口头案件提交归档完成：${caseNumber}`);

  await returnToOralCaseList();
}

export const oralCaseWorkflow: Workflow = {
  name: "口头案件办理",

  async run(context) {
    let count = 0;

    while (context.shouldContinue()) {
      const { caseNumber, signatureNames } = await openFirstOralCase();
      await wait(300);
      await processOneOralCase(caseNumber, signatureNames, context);

      count += 1;
      context.log(`口头案件处理完成：${caseNumber}`);
      context.log(`已处理口头案件数量：${count}`);
      showNotice(`口头案件处理完成：${caseNumber}，累计 ${count} 件`, "success");

      await wait(2000);
    }
  },
};
