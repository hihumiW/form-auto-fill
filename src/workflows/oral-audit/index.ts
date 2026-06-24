import { Workflow } from "@/src/automation/types";
import {
  clickVisibleButton,
  fillInputByLabel,
  findVisibleModal,
} from "@/src/browser/antd";
import { getElementText, isVisibleElement, wait, waitUntil } from "@/src/browser/dom";
import { showNotice } from "@/src/browser/notice";
import { getActiveTabText, getSelectedMenuText } from "@/src/browser/page";
import $ from "jquery";

const ORAL_AUDIT_LIST_PATH = "/layout/caseManagement/caseAudit/oralProcessingAudit";
const ORAL_AUDIT_LIST_HASH = "#/layout/caseManagement/caseAudit/oralProcessingAudit";
const TABLE_ROW_SELECTOR = ".ant-table-tbody .ant-table-row";
const AUDIT_AMOUNT = 20;

function isOralAuditListPage(): boolean {
  return location.href.includes(ORAL_AUDIT_LIST_PATH);
}

function hasOralAuditRows(): boolean {
  return !!document.querySelector(TABLE_ROW_SELECTOR);
}

function isOralAuditMenuActive(): boolean {
  return (
    getActiveTabText().includes("口头案件审核") ||
    getSelectedMenuText().includes("口头案件审核")
  );
}

async function ensureOralAuditListPage(): Promise<void> {
  if (!isOralAuditListPage()) {
    location.hash = ORAL_AUDIT_LIST_HASH;
  }

  await waitUntil("进入口头案件审核列表页", () => {
    return isOralAuditListPage() && isOralAuditMenuActive() && hasOralAuditRows();
  });
}

function findFirstPendingAuditRow(): JQuery<HTMLElement> {
  const row = Array.from(
    document.querySelectorAll<HTMLElement>(TABLE_ROW_SELECTOR)
  ).find((tableRow) => {
    const rowText = getElementText(tableRow);
    return rowText.includes("调委会申请审核") && rowText.includes("处理");
  });

  if (!row) {
    throw new Error("没有找到可处理的口头案件审核记录");
  }

  return $(row);
}

function getCaseNumberFromRowText(rowText: string): string {
  return rowText.match(/（口头）.*?号/)?.[0] || "未知案号";
}

async function openFirstPendingAuditCase(): Promise<string> {
  await ensureOralAuditListPage();

  const $row = findFirstPendingAuditRow();
  const caseNumber = getCaseNumberFromRowText(getElementText($row));

  await clickVisibleButton("处理", $row);

  await waitUntil("口头案件审核详情加载完成", () => {
    const header = document.querySelector<HTMLElement>(".case-info-header");
    return (
      getActiveTabText().includes("案件处理") &&
      Boolean(header && getElementText(header).includes("调委会申请审核"))
    );
  }, 30000, 500);

  return caseNumber;
}

async function openAuditModal(): Promise<HTMLElement> {
  await clickVisibleButton("审核");

  await waitUntil("审核弹窗加载完成", () => {
    try {
      const modalText = getElementText(findVisibleModal());
      return (
        modalText.includes("审核") &&
        modalText.includes("审核结果") &&
        modalText.includes("通过")
      );
    } catch {
      return false;
    }
  }, 30000, 500);

  return findVisibleModal()[0];
}

async function fillAuditModal(modal: HTMLElement): Promise<void> {
  await fillInputByLabel("审核金额", AUDIT_AMOUNT, {
    scope: modal,
    selector: "input",
  });
}

async function confirmAuditModal(modal: HTMLElement): Promise<void> {
  await clickVisibleButton("确定", modal);

  await waitUntil("审核弹窗关闭", () => {
    return !isVisibleElement(modal);
  }, 30000, 500);

  await waitUntil("返回口头案件审核列表页", () => {
    return isOralAuditListPage() && isOralAuditMenuActive() && hasOralAuditRows();
  }, 30000, 500);

  await wait(800);
}

export const oralAuditWorkflow: Workflow = {
  name: "口头案件审核处理",

  async run(context) {
    let count = 0;

    while (context.shouldContinue()) {
      const caseNumber = await openFirstPendingAuditCase();
      context.log(`开始审核口头案件：${caseNumber}`);

      const modal = await openAuditModal();
      await fillAuditModal(modal);
      await confirmAuditModal(modal);

      count += 1;
      context.log(`口头案件审核完成：${caseNumber}`);
      context.log(`已审核口头案件数量：${count}`);
      showNotice(`口头案件审核完成：${caseNumber}，累计 ${count} 件`, "success");

      await wait(500);
    }
  },
};
