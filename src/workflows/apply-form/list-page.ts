import $ from "jquery";
import { clickVisibleButton } from "@/src/browser/antd";
import { getElementText, waitUntil } from "@/src/browser/dom";
import {
  getActiveTabText,
  getSelectedMenuText,
  isProcessPage,
} from "@/src/browser/page";

// 确认当前页面处于当事人申请列表。
function ensureApplyListPage(): void {
  const activeTabText = getActiveTabText();
  const selectedMenuText = getSelectedMenuText();

  // 同时检查顶部页签和左侧菜单，兼容页面刷新后的不同高亮状态。
  if (
    !activeTabText.includes("当事人申请") &&
    !selectedMenuText.includes("当事人申请")
  ) {
    throw new Error("当前不在当事人申请列表页");
  }
}

// 查找第一条待受理数据行。
function findFirstPendingApplyRow(): JQuery<HTMLElement> {
  const row = Array.from(
    document.querySelectorAll<HTMLElement>(".ant-table-tbody .ant-table-row")
  ).find((tableRow) => {
    const rowText = getElementText(tableRow);
    return rowText.includes("待受理") && rowText.includes("处理");
  });

  // 没有待受理行时，说明当前列表已经处理完。
  if (!row) {
    throw new Error("没有可处理的待受理数据");
  }

  return $(row);
}

// 点击列表中的第一条待受理“处理”按钮。
export async function openFirstPendingApplyCase(): Promise<string> {
  ensureApplyListPage();

  // 记录案件编号，方便控制台排查每一轮处理对象。
  const $row = findFirstPendingApplyRow();
  const rowText = getElementText($row);
  const caseNumber = rowText.match(/\d{20,}/)?.[0] || "未知编号";

  // 点击当前行内的处理按钮，避免误点其他行按钮。
  await clickVisibleButton("处理", $row);

  // 等待进入案件受理详情页。
  await waitUntil("进入案件受理详情页", () => {
    return isProcessPage() && getActiveTabText().includes("案件受理");
  });

  return caseNumber;
}
