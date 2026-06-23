import $ from "jquery";
import jsQR from "jsqr";
import {
  clickVisibleButton,
  fillInputByLabel,
  findVisibleButton,
  findVisibleModal,
  selectDropdownByLabel,
  selectRadio,
} from "@/src/browser/antd";
import {
  getElementText,
  isVisibleElement,
  observeUntil,
  wait,
  waitUntil,
} from "@/src/browser/dom";
import { ORAL_CASE_CONFIG } from "@/src/workflows/oral-case/config";
import {
  OpenMobileSignPagePayload,
  RequestAction,
  ResponseResult,
} from "@/types";

const DEFAULT_MODAL_TIMEOUT = 30000;
const DEFAULT_POLL_INTERVAL = 500;
const BUTTON_SELECTOR = "button, .ant-btn";
const CONFIRM_BUTTON_TEXTS = ["确定", "确认"];
const SIGN_DOCUMENT_READY_TEXT = "申请书";
const SEAL_DOCUMENT_READY_TEXT = "口头协议登记表";

function getDetailContentRoot(): HTMLElement {
  return (
    document.querySelector<HTMLElement>(".content-wrapper") ||
    document.querySelector<HTMLElement>("main.ant-layout-content") ||
    document.body
  );
}

function findProtocolStep(): HTMLElement {
  const step = Array.from(
    document.querySelectorAll<HTMLElement>(".case-steps-container .step-item")
  ).find((item) => getElementText(item).includes("口头协议登记表"));

  if (!step) {
    throw new Error("没有找到口头协议登记表步骤");
  }

  return step;
}

function pickAgreementContent(): string {
  const templates = ORAL_CASE_CONFIG.agreementContents;

  if (!templates.length) {
    throw new Error("口头协议登记表协议内容模板为空");
  }

  const index = Math.floor(Math.random() * templates.length);
  return templates[index];
}

function extractAgreementAmountFromCaseInfo(root: HTMLElement): string {
  const caseInfo = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "#form_item_caseInfo"
  );
  const caseInfoText = caseInfo?.value || "";

  if (!caseInfoText.trim()) {
    return ORAL_CASE_CONFIG.agreementAmountFallback;
  }

  const amountMatch = caseInfoText.match(
    /(?:人民币|赔偿|补偿|和解金额|和解|支付|金额|共计|合计)?\s*([0-9][0-9,\s]*(?:\.\d{1,2})?)\s*元/
  );
  const amount = amountMatch?.[1]?.replace(/[,\s]/g, "");

  return amount || ORAL_CASE_CONFIG.agreementAmountFallback;
}

export function isProtocolRegisterPending(): boolean {
  return getElementText(findProtocolStep()).includes("未录入");
}

export async function openProtocolRegisterForm(): Promise<void> {
  const step = findProtocolStep();

  $(step).trigger("click");

  await observeUntil(
    "口头协议登记表加载完成",
    () => {
      const root = getDetailContentRoot();
      const contentText = getElementText(root);
      return (
        contentText.includes("口头协议登记表") &&
        contentText.includes("是否跨调调委会") &&
        contentText.includes("调解地点") &&
        contentText.includes("调解结果")
      );
    },
    { root: getDetailContentRoot() }
  );
}

export async function fillProtocolRegisterForm(): Promise<void> {

  const root = getDetailContentRoot();

  //等待口头协议登记表加载完成
  await waitUntil('等待口袋协议记录表加载完成', () => {
    // 看看申请时间有没有被自动回填， 如果回填了，则说明加载完成了
    const applyTime = root.querySelector<HTMLInputElement>('#form_item_applyTime');
    return Boolean(applyTime?.value);
  });
  await wait(300);

  await selectRadio("否", root);
  await fillInputByLabel("调解地点", ORAL_CASE_CONFIG.mediationPlace, {
    scope: root,
  });
  await selectDropdownByLabel(
    "调解结果",
    ORAL_CASE_CONFIG.mediationResult,
    { scope: root, skipWhenContains: ORAL_CASE_CONFIG.mediationResult }
  );

  await waitUntil("调解成功后续字段加载完成", () => {
    const contentText = getElementText(root);
    return (
      contentText.includes("调解协议涉及金额") &&
      contentText.includes("协议内容") &&
      contentText.includes("协议履行情况")
    );
  });

  const agreementAmount = extractAgreementAmountFromCaseInfo(root);
  const agreementContent = pickAgreementContent();

  await fillInputByLabel("调解协议涉及金额", agreementAmount, {
    scope: root,
    selector: "input",
  });
  await fillInputByLabel("协议内容", agreementContent, {
    scope: root,
  });
  await selectRadio("协议已履行", root);
}

export async function saveProtocolRegisterForm(): Promise<void> {
  const root = getDetailContentRoot();

  await clickVisibleButton("保存", root?.parentElement!);

  await waitUntil("口头协议登记表保存完成", () => {
    const pageText = getElementText(document.body);
    return (
      pageText.includes("保存成功") ||
      getElementText(findProtocolStep()).includes("已录入")
    );
  });

  await waitUntil("保存提示关闭或状态刷新", () => {
    const visibleMessages = Array.from(
      document.querySelectorAll<HTMLElement>(".ant-message-notice")
    ).filter(isVisibleElement);
    return (
      !visibleMessages.length ||
      getElementText(findProtocolStep()).includes("已录入")
    );
  });

  await wait(ORAL_CASE_CONFIG.saveSleepTime);
}

function getVisibleModalElement(): HTMLElement {
  return findVisibleModal()[0];
}

function getVisibleButtons(scope: ParentNode = document): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(BUTTON_SELECTOR)).filter(
    isVisibleElement
  );
}

function hasVisibleButton(text: string, scope: ParentNode = document): boolean {
  return getVisibleButtons(scope).some((button) =>
    getElementText(button).includes(text.replace(/\s+/g, ""))
  );
}

function getVisibleModalElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".ant-modal")).filter(
    isVisibleElement
  );
}

function findVisibleModalByText(text: string): HTMLElement | undefined {
  const normalizedText = text.replace(/\s+/g, "");
  return getVisibleModalElements().find((modal) =>
    getElementText(modal).includes(normalizedText)
  );
}

function findModalClickableByText(
  modal: HTMLElement,
  text: string,
  selector = "button, .ant-btn, .target-type-item, div, span"
): HTMLElement {
  const normalizedText = text.replace(/\s+/g, "");
  const target = Array.from(modal.querySelectorAll<HTMLElement>(selector)).find(
    (element) => {
      return (
        isVisibleElement(element) &&
        getElementText(element).includes(normalizedText)
      );
    }
  );

  if (!target) {
    throw new Error(`弹窗中没有找到可点击项：${text}`);
  }

  return target;
}

async function waitForVisibleModal(description = "签字弹窗出现"): Promise<HTMLElement> {
  await waitUntil(description, () => {
    try {
      getVisibleModalElement();
      return true;
    } catch {
      return false;
    }
  });

  return getVisibleModalElement();
}

async function clickModalText(
  modal: HTMLElement,
  text: string,
  selector?: string
): Promise<void> {
  $(findModalClickableByText(modal, text, selector)).trigger("click");
  await wait(500);
}

async function clickModalConfirmButton(modal: HTMLElement): Promise<void> {
  const button = CONFIRM_BUTTON_TEXTS
    .map((text) => {
      try {
        return findVisibleButton(text, modal)[0];
      } catch {
        return undefined;
      }
    })
    .find(Boolean);

  if (!button) {
    throw new Error("弹窗中没有找到确认按钮");
  }

  $(button).trigger("click");
  await wait(500);
}

async function selectAllModalDocuments(modal: HTMLElement): Promise<void> {
  await wait(300);
  const checkboxes = Array.from(
    modal.querySelectorAll<HTMLInputElement>("input[type='checkbox']")
  ).filter((input) => !input.disabled);

  if (!checkboxes.length) {
    throw new Error("选择文书弹窗中没有找到复选框");
  }

  for (const checkbox of checkboxes) {
    if (checkbox.checked) continue;

    const clickable =
      checkbox.closest<HTMLElement>(".ant-checkbox-wrapper") ||
      checkbox.closest<HTMLElement>(".ant-checkbox") ||
      checkbox;

    $(clickable).trigger("click");
    await wait(150);
  }
}

async function waitForModalText(
  modal: HTMLElement,
  text: string,
  description: string
): Promise<void> {
  await waitUntil(
    description,
    () => isVisibleElement(modal) && getElementText(modal).includes(text),
    DEFAULT_MODAL_TIMEOUT,
    DEFAULT_POLL_INTERVAL
  );
}

async function waitForModalClosed(
  modal: HTMLElement,
  description: string
): Promise<void> {
  await waitUntil(
    description,
    () => !isVisibleElement(modal),
    DEFAULT_MODAL_TIMEOUT,
    DEFAULT_POLL_INTERVAL
  );
}

function getQrSourceElement(modal: HTMLElement): HTMLCanvasElement | HTMLImageElement {
  const candidates = Array.from(
    modal.querySelectorAll<HTMLCanvasElement | HTMLImageElement>("canvas, img")
  ).filter((element) => {
    const rect = element.getBoundingClientRect();
    return isVisibleElement(element) && rect.width >= 120 && rect.height >= 120;
  });

  const source = candidates[0];
  if (!source) {
    throw new Error("二维码弹窗中没有找到二维码图片");
  }

  return source;
}

async function drawImageToCanvas(image: HTMLImageElement): Promise<HTMLCanvasElement> {
  if (!image.complete) {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("二维码图片加载失败"));
    });
  }

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("无法创建二维码解析画布");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function decodeQrUrl(modal: HTMLElement): Promise<string> {
  const sourceElement = getQrSourceElement(modal);
  const canvas =
    sourceElement instanceof HTMLImageElement
      ? await drawImageToCanvas(sourceElement)
      : sourceElement;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("无法读取二维码画布");
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(imageData.data, imageData.width, imageData.height);
  const url = result?.data || "";

  if (!/^https?:\/\//.test(url)) {
    throw new Error("二维码解析结果不是有效的 http/https 地址");
  }

  return url;
}

async function openMobileSignPage(
  url: string,
  signatureNames: string[]
): Promise<void> {
  const response = (await browser.runtime.sendMessage({
    action: "openMobileSignPage",
    data: {
      url,
      signatureMode: ORAL_CASE_CONFIG.signatureMode,
      autoSignatureMode: ORAL_CASE_CONFIG.autoSignatureMode,
      signatureNames,
      signatureFonts: ORAL_CASE_CONFIG.signatureFonts,
      skeletonConfig: ORAL_CASE_CONFIG.skeletonSignature,
    },
  } satisfies RequestAction<OpenMobileSignPagePayload>)) as ResponseResult;

  if (!response?.success) {
    throw new Error(response?.errorMessage || "移动端签字失败");
  }
}

async function closeQrCodeModal(modal: HTMLElement): Promise<void> {
  await clickVisibleButton("关闭", modal);
  await waitForModalClosed(modal, "二维码弹窗关闭");
}

async function waitForSealButtonReady(): Promise<void> {
  await waitUntil(
    "签章按钮出现",
    () => hasVisibleButton("签章"),
    DEFAULT_MODAL_TIMEOUT,
    DEFAULT_POLL_INTERVAL
  );
}

function isSealButtonReady(): boolean {
  return hasVisibleButton("签章");
}

export async function runSignatureFlow(signatureNames: string[]): Promise<void> {
  if (isSealButtonReady()) {
    return;
  }

  await clickVisibleButton("签字");

  for (let step = 0; step < 8; step += 1) {
    const modal = await waitForVisibleModal();
    const modalText = getElementText(modal);

    if (modalText.includes("选择签字方式")) {
      await clickModalText(modal, "本地签署", ".target-type-item");
      await wait(500);
      continue;
    }

    if (modalText.includes("请确认是否选择") || modalText.includes("本地签署方式")) {
      await clickVisibleButton("确认", modal);
      await wait(500);
      continue;
    }

    if (modalText.includes("选择文书")) {
      await waitForModalText(modal, SIGN_DOCUMENT_READY_TEXT, "签字文书加载完成");
      await selectAllModalDocuments(modal);
      await clickVisibleButton("确认", modal);
      await wait(500);
      continue;
    }

    if (modalText.includes("生成二维码") || modalText.includes("二维码")) {
      const qrUrl = await decodeQrUrl(modal);
      console.log(qrUrl, 'qrUrl');
      // throw Error('test');
      await openMobileSignPage(qrUrl, signatureNames);
      await closeQrCodeModal(modal);
      await waitForSealButtonReady();
      return;
    }

    await wait(500);
  }

  throw new Error("签字流程未能进入二维码步骤");
}

export async function runSealFlow(): Promise<void> {
  await clickVisibleButton("签章");

  const modal = await waitForVisibleModal("签章选择文书弹窗出现");

  await waitForModalText(modal, SEAL_DOCUMENT_READY_TEXT, "签章文书加载完成");

  await selectAllModalDocuments(modal);
  await clickVisibleButton("确认", modal);

  await waitForModalClosed(modal, "签章选择文书弹窗关闭");

  await wait(800);
}

export async function runArchiveFlow(): Promise<void> {
  let previewModal = findVisibleModalByText("提交归档预览");

  if (!previewModal) {
    await clickVisibleButton("提交归档");

    await waitUntil(
      "提交归档预览弹窗打开",
      () => {
        previewModal = findVisibleModalByText("提交归档预览");
        return Boolean(previewModal);
      },
      DEFAULT_MODAL_TIMEOUT,
      DEFAULT_POLL_INTERVAL
    );
  }

  if (!previewModal) {
    throw new Error("没有找到提交归档预览弹窗");
  }

  await clickModalConfirmButton(previewModal);

  let confirmModal: HTMLElement | undefined;
  await waitUntil(
    "归档确认提示弹窗打开",
    () => {
      confirmModal = findVisibleModalByText("归档提示");
      return Boolean(confirmModal);
    },
    DEFAULT_MODAL_TIMEOUT,
    DEFAULT_POLL_INTERVAL
  );

  if (!confirmModal) {
    throw new Error("没有找到归档确认提示弹窗");
  }

  await clickModalConfirmButton(confirmModal);

  await waitUntil(
    "归档确认提示弹窗关闭",
    () => !confirmModal || !isVisibleElement(confirmModal),
    DEFAULT_MODAL_TIMEOUT,
    DEFAULT_POLL_INTERVAL
  );

  await wait(1000);
}
