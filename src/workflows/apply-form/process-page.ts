import { clickVisibleButton, findVisibleButton } from "@/src/browser/antd";
import {
  getElementText,
  isVisibleElement,
  observeUntil,
  waitUntil,
} from "@/src/browser/dom";
import {
  getActiveTabText,
  isClientSubscribePage,
  isProcessPage,
} from "@/src/browser/page";

// 获取案件受理详情页头部区域。
function getCaseInfoHeader(): HTMLElement {
  const header = document.querySelector<HTMLElement>(".case-info-header");

  // 详情页头部不存在时，说明当前页面不是案件受理详情。
  if (!header) {
    throw new Error("没有找到案件受理详情页头部区域");
  }

  return header;
}

// 获取案件详情页主体区域，用于监听申请书异步渲染。
function getProcessContentRoot(): HTMLElement {
  return (
    document.querySelector<HTMLElement>(".content-box") ||
    document.querySelector<HTMLElement>("main.ant-layout-content") ||
    document.body
  );
}

// 判断案件受理详情页头部是否已经从占位状态加载为真实案件数据。
function isCaseHeaderDataReady(header: HTMLElement): boolean {
  const headerText = getElementText(header);

  // 初始加载时编号、调解员、日期、状态通常都是“-”，真实加载后会出现编号和“待受理”。
  return /\d{20,}/.test(headerText) && headerText.includes("待受理");
}

// 判断案件受理详情页的申请书区域是否已经加载完成。
function isApplicationBookReady(): boolean {
  const processContentRoot = getProcessContentRoot();
  const processContentText = getElementText(processContentRoot);
  const visiblePdfCanvas = processContentRoot.querySelector<HTMLCanvasElement>(
    ".pdf-preview .vue-pdf-embed__page canvas"
  );
  const visiblePdfPage = processContentRoot.querySelector<HTMLElement>(
    ".pdf-preview .vue-pdf-embed__page"
  );

  // 判断申请书 和 申请书的pdf是否出现
  return (
    processContentText.includes("申请书") &&
    (isVisibleElement(visiblePdfCanvas) || isVisibleElement(visiblePdfPage))
  );
}

// 等待申请书加载完成，并等待“受理”按钮被页面挂载出来。
async function waitForAcceptButtonReady(): Promise<void> {
  // 先监听详情页主体区域，等头部占位数据和申请书正文都加载完成。
  await observeUntil("案件受理详情数据和申请书加载完成", () => {
    try {
      const header = getCaseInfoHeader();
      return isCaseHeaderDataReady(header) && isApplicationBookReady();
    } catch {
      return false;
    }
  }, {
    root: getProcessContentRoot(),
  });

  // 再监听头部区域，等“受理”按钮真正挂载出来。
  await observeUntil("受理按钮出现", () => {
    try {
      findVisibleButton("受理", getCaseInfoHeader());
      return true;
    } catch {
      return false;
    }
  }, {
    root: getCaseInfoHeader(),
  });
}

// 打开案件受理弹窗。
export async function openAcceptanceModal(): Promise<void> {
  // 详情页会先显示占位头部，申请书加载完成后才出现“受理”按钮。
  await waitForAcceptButtonReady();

  // 点击头部的“受 理”按钮，按钮文字可能带空格。
  await clickVisibleButton("受理", getCaseInfoHeader());

  // 等待弹窗基础结构出现。
  await waitUntil("案件受理弹窗打开", () => {
    const modal = Array.from(document.querySelectorAll<HTMLElement>(".ant-modal")).find(
      (element) => element.getBoundingClientRect().width > 0
    );
    const modalText = modal ? getElementText(modal) : "";
    return modalText.includes("案件受理") && modalText.includes("受理意见");
  });
}

// 返回当事人申请列表，并等待表格重新渲染完成。
export async function returnToApplyList(): Promise<void> {
  const header = getCaseInfoHeader();

  // 点击详情页头部的“返 回”按钮。
  await clickVisibleButton("返回", header);

  // 等待回到当事人申请列表页。
  await waitUntil("返回当事人申请列表页", () => {
    return (
      isClientSubscribePage() &&
      !isProcessPage() &&
      getActiveTabText().includes("当事人申请") &&
      !!document.querySelector(".ant-table-tbody .ant-table-row")
    );
  });
}
