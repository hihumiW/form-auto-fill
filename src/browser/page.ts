import { getElementText } from "@/src/browser/dom";

// 获取当前激活的顶部页签文本。
export function getActiveTabText(): string {
  return getElementText(
    document.querySelector(".ant-tabs-tab-active") || document.body
  );
}

// 获取当前左侧选中菜单文本。
export function getSelectedMenuText(): string {
  return getElementText(
    document.querySelector(".ant-menu-item-selected") || document.body
  );
}

// 判断当前 URL 是否处于案件处理详情页。
export function isProcessPage(): boolean {
  return location.href.includes("/process");
}

// 判断当前 URL 是否处于当事人申请模块。
export function isClientSubscribePage(): boolean {
  return location.href.includes("clientSubscribe");
}
