import $ from "jquery";
import { clickVisibleButton } from "@/src/browser/antd";
import { getElementText, waitUntil } from "@/src/browser/dom";
import { getActiveTabText, getSelectedMenuText } from "@/src/browser/page";
import { ORAL_CASE_CONFIG } from "@/src/workflows/oral-case/config";

const ORAL_CASE_LIST_PATH = "/layout/caseManagement/caseHandling/oralProcessing";
const ORAL_CASE_DETAIL_PATH = "/layout/caseManagement/caseHandling/oralCaseForms";
const TABLE_ROW_SELECTOR = ".ant-table-tbody .ant-table-row";

export interface OralCaseListSelection {
  caseNumber: string;
  signatureNames: string[];
}

export interface OralCaseArchiveSelection {
  caseNumber: string;
}

export function isOralCaseListPage(): boolean {
  // 判断当前地址是否停留在口头案件列表页。
  return location.href.includes(ORAL_CASE_LIST_PATH);
}

export function isOralCaseDetailPage(): boolean {
  // 判断当前地址是否已经进入口头案件详情页。
  return location.href.includes(ORAL_CASE_DETAIL_PATH);
}

function hasOralCaseListRows(): boolean {
  // 确认列表中已经渲染出案件行。
  return !!document.querySelector(TABLE_ROW_SELECTOR);
}

function isOralCaseMenuActive(): boolean {
  // 通过页签和左侧菜单双重判断，避免 hash 已变化但页面尚未完成渲染。
  return (
    getActiveTabText().includes("口头案件办理") ||
    getSelectedMenuText().includes("口头案件办理")
  );
}

export async function ensureOralCaseListPage(): Promise<void> {
  // 如果当前不在口头案件列表页，先切换 hash 进入目标页面。
  if (!isOralCaseListPage()) {
    location.hash = ORAL_CASE_CONFIG.listHash;
  }

  // 等待页面、菜单和表格行都就绪后再继续。
  await waitUntil("进入口头案件办理列表页", () => {
    return (
      isOralCaseListPage() &&
      isOralCaseMenuActive() &&
      hasOralCaseListRows()
    );
  });
}

function findFirstOralCaseRow(): JQuery<HTMLElement> {
  // 找到第一条包含“编辑”操作的案件行。
  const row = Array.from(
    document.querySelectorAll<HTMLElement>(TABLE_ROW_SELECTOR)
  ).find((tableRow) => {
    return getElementText(tableRow).includes("编辑");
  });

  // 如果没有可编辑行，说明当前列表没有可自动处理的口头案件。
  if (!row) {
    throw new Error("没有找到可编辑的口头案件记录");
  }

  // 返回 jQuery 对象，保持与现有点击工具的调用方式一致。
  return $(row);
}

function findFirstOralCaseArchiveRow(
  attemptedCaseNumbers: Set<string>
): JQuery<HTMLElement> | null {
  const row = Array.from(
    document.querySelectorAll<HTMLElement>(TABLE_ROW_SELECTOR)
  ).find((tableRow) => {
    const rowText = getElementText(tableRow);
    const caseNumber = getCaseNumberFromRowText(rowText);

    return (
      rowText.includes("处理") &&
      Boolean(caseNumber) &&
      !attemptedCaseNumbers.has(caseNumber)
    );
  });

  return row ? $(row) : null;
}

function getCaseNumberFromRowText(rowText: string): string {
  return rowText.match(/（口头）.*?号/)?.[0] || "未知案号";
}

function normalizeCellText(text?: string | null): string {
  // 去掉表格单元格中的多余空白，保证列名和姓名提取稳定。
  return (text || "").replace(/\s+/g, "").trim();
}

function findTableHeaderIndex(row: HTMLElement, headerText: string): number {
  // 从当前行回溯到所在表格，再根据表头文字定位列下标。
  const table = row.closest("table") || document.querySelector("table");
  const headers = Array.from(table?.querySelectorAll("thead th") || []);
  const index = headers.findIndex((header) =>
    normalizeCellText(header.textContent).includes(headerText)
  );

  // 如果页面表头结构变化，直接抛错，避免拿错姓名继续签字。
  if (index < 0) {
    throw new Error(`没有找到表格列：${headerText}`);
  }

  return index;
}

function getRowCellText(row: HTMLElement, index: number): string {
  // 根据表头下标读取当前行对应单元格文本。
  const cells = Array.from(row.querySelectorAll("td"));
  return normalizeCellText(cells[index]?.textContent);
}

function splitPersonNames(text: string): string[] {
  // 当事人可能用中文逗号、英文逗号、顿号或空白分隔，这里统一拆成姓名数组。
  return text
    .split(/[,\uFF0C\u3001\s]+/)
    .map((name) => normalizeCellText(name))
    .filter(Boolean);
}

function getSignatureNamesFromRow(row: HTMLElement): string[] {
  // 固定四个签字点顺序：当事人1、当事人1、当事人2、调解员。
  const partyIndex = findTableHeaderIndex(row, "当事人");
  const mediatorIndex = findTableHeaderIndex(row, "调解员");
  const parties = splitPersonNames(getRowCellText(row, partyIndex));
  const mediator = normalizeCellText(getRowCellText(row, mediatorIndex));

  // 自动签字需要两个当事人和一个调解员，缺失时交给后续人工降级处理。
  return [parties[0] || "", parties[0] || "", parties[1] || "", mediator];
}

export async function openFirstOralCase(): Promise<OralCaseListSelection> {
  // 进入列表页并等待表格就绪。
  await ensureOralCaseListPage();

  // 读取第一条可编辑案件行中的案件号和签名姓名。
  const $row = findFirstOralCaseRow();
  const rowText = getElementText($row);
  const caseNumber = getCaseNumberFromRowText(rowText);
  const signatureNames = getSignatureNamesFromRow($row[0]);

  // 点击编辑进入详情页。
  await clickVisibleButton("编辑", $row);

  // 等待详情页关键容器出现。
  await waitUntil("进入口头案件办理详情页", () => {
    return (
      isOralCaseDetailPage() &&
      getActiveTabText().includes("口头案件办理详情") &&
      !!document.querySelector(".case-steps-container")
    );
  });

  return { caseNumber, signatureNames };
}

export async function openFirstOralCaseForArchive(
  attemptedCaseNumbers: Set<string>
): Promise<OralCaseArchiveSelection | null> {
  await ensureOralCaseListPage();

  const $row = findFirstOralCaseArchiveRow(attemptedCaseNumbers);
  if (!$row) {
    return null;
  }

  const caseNumber = getCaseNumberFromRowText(getElementText($row));
  attemptedCaseNumbers.add(caseNumber);

  await clickVisibleButton("处理", $row);

  await waitUntil("进入口头案件办理详情页", () => {
    return (
      isOralCaseDetailPage() &&
      getActiveTabText().includes("口头案件办理详情") &&
      !!document.querySelector(".case-steps-container")
    );
  });

  return { caseNumber };
}

export async function returnToOralCaseList(): Promise<void> {
  // 点击返回按钮回到列表。
  await clickVisibleButton("返回");

  // 等待列表页恢复，并确保详情页已经离开。
  await waitUntil("返回口头案件办理列表页", () => {
    return (
      isOralCaseListPage() &&
      !isOralCaseDetailPage() &&
      isOralCaseMenuActive() &&
      hasOralCaseListRows()
    );
  }, 30000, 500);
}
