import $ from "jquery";
import { clickVisibleButton } from "@/src/browser/antd";
import { getElementText, waitUntil } from "@/src/browser/dom";
import { getActiveTabText, getSelectedMenuText } from "@/src/browser/page";
import { ORAL_CASE_CONFIG } from "@/src/workflows/oral-case/config";

const ORAL_CASE_LIST_PATH = "/layout/caseManagement/caseHandling/oralProcessing";
const ORAL_CASE_DETAIL_PATH = "/layout/caseManagement/caseHandling/oralCaseForms";
const TABLE_ROW_SELECTOR = ".ant-table-tbody .ant-table-row";

export function isOralCaseListPage(): boolean {
  return location.href.includes(ORAL_CASE_LIST_PATH);
}

export function isOralCaseDetailPage(): boolean {
  return location.href.includes(ORAL_CASE_DETAIL_PATH);
}

function hasOralCaseListRows(): boolean {
  return !!document.querySelector(TABLE_ROW_SELECTOR);
}

function isOralCaseMenuActive(): boolean {
  return (
    getActiveTabText().includes("口头案件办理") ||
    getSelectedMenuText().includes("口头案件办理")
  );
}

function getDetailHeader(): HTMLElement {
  return (
    document.querySelector<HTMLElement>(".content-wrapper") ||
    document.querySelector<HTMLElement>("main.ant-layout-content") ||
    document.body
  );
}

export async function ensureOralCaseListPage(): Promise<void> {
  if (!isOralCaseListPage()) {
    location.hash = ORAL_CASE_CONFIG.listHash;
  }

  await waitUntil("进入口头案件办理列表页", () => {
    return (
      isOralCaseListPage() &&
      isOralCaseMenuActive() &&
      hasOralCaseListRows()
    );
  });
}

function findFirstOralCaseRow(): JQuery<HTMLElement> {
  const row = Array.from(
    document.querySelectorAll<HTMLElement>(TABLE_ROW_SELECTOR)
  ).find((tableRow) => {
    return getElementText(tableRow).includes("编辑");
  });

  if (!row) {
    throw new Error("没有找到可编辑的口头案件记录");
  }

  return $(row);
}

export async function openFirstOralCase(): Promise<string> {
  await ensureOralCaseListPage();

  const $row = findFirstOralCaseRow();
  const rowText = getElementText($row);
  const caseNumber = rowText.match(/（口头）.*?号/)?.[0] || "未知案号";

  await clickVisibleButton("编辑", $row);

  await waitUntil("进入口头案件办理详情页", () => {
    return (
      isOralCaseDetailPage() &&
      getActiveTabText().includes("口头案件办理详情") &&
      !!document.querySelector(".case-steps-container")
    );
  });

  return caseNumber;
}

export async function returnToOralCaseList(): Promise<void> {
  await clickVisibleButton("返回");

  await waitUntil("返回口头案件办理列表页", () => {
    return (
      isOralCaseListPage() &&
      !isOralCaseDetailPage() &&
      isOralCaseMenuActive() &&
      hasOralCaseListRows()
    );
  }, 30000, 500);
}
