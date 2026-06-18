import type {
  OpenMobileSignPagePayload,
  RequestAction,
  ResponseResult,
  SignatureMode,
} from "@/types";

const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const DEBUGGER_VERSION = "1.3";
const MOBILE_VIEWPORT = {
  width: 430,
  height: 932,
  deviceScaleFactor: 3,
};
const SIGN_PAGE_LOAD_TIMEOUT = 30000;

type MobileSignScriptResult =
  | { success: true }
  | { success: false; errorMessage: string };

interface Debuggee {
  tabId: number;
}

declare const chrome: {
  runtime: {
    lastError?: {
      message?: string;
    };
  };
  debugger: {
    attach(
      target: Debuggee,
      requiredVersion: string,
      callback: () => void
    ): void;
    detach(target: Debuggee, callback: () => void): void;
    sendCommand(
      target: Debuggee,
      method: string,
      commandParams: Record<string, unknown> | undefined,
      callback: (result: unknown) => void
    ): void;
  };
};

function chromeLastErrorMessage(defaultMessage: string): string {
  return chrome.runtime.lastError?.message || defaultMessage;
}

function attachDebugger(debuggee: Debuggee): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(debuggee, DEBUGGER_VERSION, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

function detachDebugger(debuggee: Debuggee): Promise<void> {
  return new Promise((resolve) => {
    chrome.debugger.detach(debuggee, () => {
      resolve();
    });
  });
}

function sendDebuggerCommand(
  debuggee: Debuggee,
  method: string,
  commandParams?: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggee, method, commandParams, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(result);
    });
  });
}

async function waitForTabComplete(
  tabId: number,
  timeout = SIGN_PAGE_LOAD_TIMEOUT
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const tab = await browser.tabs.get(tabId);
    if (tab.status === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("移动端签字页面加载超时");
}

async function setupMobileEnvironment(debuggee: Debuggee): Promise<void> {
  await sendDebuggerCommand(debuggee, "Network.enable");
  await sendDebuggerCommand(debuggee, "Network.setUserAgentOverride", {
    userAgent: MOBILE_USER_AGENT,
    platform: "iPhone",
  });
  await sendDebuggerCommand(debuggee, "Emulation.setDeviceMetricsOverride", {
    width: MOBILE_VIEWPORT.width,
    height: MOBILE_VIEWPORT.height,
    deviceScaleFactor: MOBILE_VIEWPORT.deviceScaleFactor,
    mobile: true,
  });
  await sendDebuggerCommand(debuggee, "Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
}

async function executeMobileSignScript(
  tabId: number,
  signatureMode: SignatureMode
): Promise<void> {
  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: mobileSignAutomation,
    args: [signatureMode],
  });

  const values = results.map((result) => result?.result) as Array<
    MobileSignScriptResult | undefined
  >;
  const success = values.find((value) => value?.success);

  if (success) {
    return;
  }

  const errorMessage = values
    .map((value) => (value && !value.success ? value.errorMessage : undefined))
    .filter(Boolean)
    .join("；");
  throw new Error(errorMessage || "移动端签字脚本执行失败");
}

async function openMobileSignPage(
  payload: OpenMobileSignPagePayload
): Promise<ResponseResult> {
  if (!/^https?:\/\//.test(payload.url)) {
    throw new Error(`签字二维码地址不合法：${payload.url}`);
  }

  const tab = await browser.tabs.create({
    active: true,
    url: "about:blank",
  });

  if (!tab.id) {
    throw new Error("移动端签字页面创建失败");
  }

  const debuggee: Debuggee = { tabId: tab.id };
  let debuggerAttached = false;

  try {
    await attachDebugger(debuggee);
    debuggerAttached = true;
    await setupMobileEnvironment(debuggee);
    await browser.tabs.update(tab.id, { url: payload.url });
    await waitForTabComplete(tab.id);
    await executeMobileSignScript(tab.id, payload.signatureMode || "auto");
    await browser.tabs.remove(tab.id);
    return { success: true, data: null };
  } finally {
    if (debuggerAttached) {
      await detachDebugger(debuggee);
    }
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (
      request: RequestAction<OpenMobileSignPagePayload>,
      _sender,
      sendResponse
    ) => {
      if (request.action !== "openMobileSignPage") {
        return;
      }

      openMobileSignPage(request.data)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            success: false,
            data: null,
            errorMessage: error?.message || chromeLastErrorMessage("移动端签字失败"),
          } satisfies ResponseResult);
        });

      return true;
    }
  );
});

function mobileSignAutomation(
  signatureMode: "manual" | "auto" = "auto"
): Promise<
  MobileSignScriptResult
> {
  type Point = [number, number];
  type Stroke = Point[];
  type StrokeEventType = "start" | "move" | "end";
  type EventWindow = Window & typeof globalThis;

  const SELECTORS = {
    positionButton: ".ax-pdf-overlay-position-btn",
    positionCount: ".ax-pdf-overlay-count",
    focusedSignature: ".overlay-elem.required.overlay-elem-img.focus",
    signatureEntry:
      ".overlay-elem.required.overlay-elem-img, .img-sign-wrapper, [class*='img-sign'], [class*='sign-wrapper'], [class*='signWrapper'], .element-wrapper",
    signatureContainer:
      ".van-popup, .van-dialog, .signature, .sign, [class*='sign'], [class*='Signature']",
    clickable: "button, .van-button, [role='button'], a, div, span",
  };
  const TEXT = {
    signatureEntry: ["\u7b7e\u5b57", "\u7b7e\u540d"],
    signatureConfirm: ["\u786e\u8ba4", "\u786e\u5b9a", "\u4fdd\u5b58", "\u5b8c\u6210"],
    submit: ["\u63d0\u4ea4\u7b7e\u7f72", "\u63d0\u4ea4\u7b7e\u5b57", "\u63d0\u4ea4"],
  };
  const SIGN_LIMITS = {
    maxSignaturePositions: 12,
    focusTimeout: 3000,
    countDecreaseTimeout: 8000,
    pageReadyTimeout: 30000,
    manualSignatureTimeout: 10 * 60 * 1000,
    manualSuccessTimeout: 10 * 60 * 1000,
    submitButtonTimeout: 15000,
    submitSettleDelay: 5000,
    initialDelay: 1500,
  };
  const STROKE_LIMITS = {
    pressureMin: 0.08,
    pressureMax: 0.22,
    moveDelayMin: 10,
    moveDelayMax: 25,
  };

  const wait = (duration: number) =>
    new Promise((resolve) => window.setTimeout(resolve, duration));

  const normalizeText = (text?: string | null) => (text || "").replace(/\s+/g, "");

  const getSearchDocuments = (): Document[] => {
    const documents: Document[] = [document];
    const visited = new Set<Document>(documents);

    for (const currentDocument of documents) {
      const frames = Array.from(currentDocument.querySelectorAll("iframe"));

      for (const frame of frames) {
        try {
          const frameDocument = frame.contentDocument;
          if (frameDocument && !visited.has(frameDocument)) {
            visited.add(frameDocument);
            documents.push(frameDocument);
          }
        } catch {
          // Cross-origin frames cannot be inspected from the top document.
        }
      }
    }

    return documents;
  };

  const queryAll = <T extends Element>(selector: string): T[] =>
    getSearchDocuments().flatMap((currentDocument) =>
      Array.from(currentDocument.querySelectorAll<T>(selector))
    );

  const getElementWindow = (element: Element): EventWindow =>
    (element.ownerDocument.defaultView || window) as EventWindow;

  const isVisible = (element?: Element | null): element is HTMLElement => {
    if (!element) return false;
    const htmlElement = element as HTMLElement;
    const rect = htmlElement.getBoundingClientRect();
    const style = getElementWindow(htmlElement).getComputedStyle(htmlElement);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0
    );
  };

  const getElementText = (element: Element) =>
    normalizeText(element.textContent || "");

  const findClickableByText = (
    texts: string[],
    options: { exclude?: string[] } = {}
  ): HTMLElement | undefined => {
    const normalizedTexts = texts.map(normalizeText);
    const excludes = (options.exclude || []).map(normalizeText);
    const candidates = queryAll<HTMLElement>(SELECTORS.clickable).filter(isVisible);

    return candidates
      .filter((candidate) => {
        const text = getElementText(candidate);
        return (
          normalizedTexts.some((item) => text.includes(item)) &&
          !excludes.some((item) => text.includes(item))
        );
      })
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        const leftArea = leftRect.width * leftRect.height;
        const rightArea = rightRect.width * rightRect.height;
        const leftPriority =
          left.tagName === "BUTTON" ||
          left.className.toString().includes("button") ||
          left.getAttribute("role") === "button"
            ? 0
            : 1;
        const rightPriority =
          right.tagName === "BUTTON" ||
          right.className.toString().includes("button") ||
          right.getAttribute("role") === "button"
            ? 0
            : 1;
        return leftPriority - rightPriority || leftArea - rightArea;
      })[0];
  };

  const findSignatureImageEntry = (): HTMLElement | undefined => {
    const focused = queryAll<HTMLElement>(SELECTORS.focusedSignature)[0];

    if (isVisible(focused)) {
      return focused;
    }

    const candidates = queryAll<HTMLElement>(SELECTORS.signatureEntry)
      .filter(isVisible)
      .filter((element) => {
        const text = getElementText(element);
        const className = element.className.toString();
        return (
          TEXT.signatureEntry.some((item) => text.includes(item)) ||
          className.includes("overlay-elem-img") ||
          className.includes("sign") ||
          !!element.querySelector("img")
        );
      })
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        const leftArea = leftRect.width * leftRect.height;
        const rightArea = rightRect.width * rightRect.height;
        return leftArea - rightArea;
      });

    return candidates[0];
  };

  const findPositionButton = (): HTMLElement | undefined => {
    const button = queryAll<HTMLElement>(SELECTORS.positionButton)[0];
    return isVisible(button) ? button : undefined;
  };

  const getPositionCount = (): number => {
    const button = findPositionButton();
    const wrapper = button?.parentElement;
    const countText =
      wrapper?.querySelector<HTMLElement>(SELECTORS.positionCount)?.textContent ||
      wrapper?.textContent ||
      "";
    const count = Number.parseInt(countText.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(count) ? count : 0;
  };

  const focusNextSignature = async (): Promise<number> => {
    const count = getPositionCount();
    const button = findPositionButton();

    if (!button || count <= 0) {
      return count;
    }

    clickElement(button);
    await wait(500);

    const startTime = Date.now();
    while (Date.now() - startTime < SIGN_LIMITS.focusTimeout) {
      if (findSignatureImageEntry()?.classList.contains("focus")) {
        break;
      }
      await wait(200);
    }

    return getPositionCount();
  };

  const waitForPositionCountBelow = async (
    previousCount: number,
    timeout = SIGN_LIMITS.countDecreaseTimeout
  ): Promise<number> => {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const currentCount = getPositionCount();
      if (currentCount < previousCount) {
        return currentCount;
      }
      await wait(300);
    }

    return getPositionCount();
  };

  const clickElement = (element: HTMLElement) => {
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const elementWindow = getElementWindow(element);
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      element.dispatchEvent(
        new elementWindow.MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        })
      );
    }
    element.click();
  };

  const topSignTarget = (): HTMLElement => {
    const dialog = queryAll<HTMLElement>(SELECTORS.signatureContainer)
      .filter(isVisible)
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
      })[0];

    return dialog || findPositionButton()?.ownerDocument.body || document.body;
  };

  const randomBetween = (min: number, max: number): number =>
    min + Math.random() * (max - min);

  const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

  const quadraticPoint = (
    start: Point,
    control: Point,
    end: Point,
    ratio: number
  ): Point => {
    const inverse = 1 - ratio;
    return [
      inverse * inverse * start[0] + 2 * inverse * ratio * control[0] + ratio * ratio * end[0],
      inverse * inverse * start[1] + 2 * inverse * ratio * control[1] + ratio * ratio * end[1],
    ];
  };

  const makeTouch = (
    target: EventTarget,
    identifier: number,
    x: number,
    y: number,
    force: number
  ): Touch | undefined => {
    try {
      return new Touch({
        identifier,
        target,
        clientX: x,
        clientY: y,
        radiusX: 1,
        radiusY: 1,
        rotationAngle: 0,
        force,
      });
    } catch {
      return undefined;
    }
  };

  const dispatchStrokeEvent = (
    type: StrokeEventType,
    target: HTMLElement,
    x: number,
    y: number,
    pointerId: number,
    force: number
  ): void => {
    const targetDocument = target.ownerDocument;
    const targetWindow = (targetDocument.defaultView || window) as EventWindow;
    const eventTarget = targetDocument.elementFromPoint(x, y) || target;
    const pointerType =
      type === "start" ? "pointerdown" : type === "move" ? "pointermove" : "pointerup";
    const mouseType =
      type === "start" ? "mousedown" : type === "move" ? "mousemove" : "mouseup";

    eventTarget.dispatchEvent(
      new targetWindow.PointerEvent(pointerType, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        width: 1,
        height: 1,
        pointerId,
        pointerType: "touch",
        isPrimary: true,
        pressure: type === "end" ? 0 : force,
      })
    );

    const touch = makeTouch(eventTarget, pointerId, x, y, force);
    if (touch) {
      const touchEventType =
        type === "start" ? "touchstart" : type === "move" ? "touchmove" : "touchend";
      eventTarget.dispatchEvent(
        new TouchEvent(touchEventType, {
          bubbles: true,
          cancelable: true,
          touches: type === "end" ? [] : [touch],
          targetTouches: type === "end" ? [] : [touch],
          changedTouches: [touch],
        })
      );
    }

    eventTarget.dispatchEvent(
      new targetWindow.MouseEvent(mouseType, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      })
    );
  };

  const createSignatureStrokes = (target: HTMLElement): Stroke[] => {
    const rect = target.getBoundingClientRect();
    const fallbackWidth = Math.min(window.innerWidth * 0.78, 360);
    const fallbackHeight = Math.min(window.innerHeight * 0.32, 180);
    const left = rect.width > 80 ? rect.left : (window.innerWidth - fallbackWidth) / 2;
    const top = rect.height > 80 ? rect.top : window.innerHeight * 0.34;
    const width = rect.width > 80 ? rect.width : fallbackWidth;
    const height = rect.height > 80 ? rect.height : fallbackHeight;
    const paddingX = width * randomBetween(0.14, 0.22);
    const paddingY = height * randomBetween(0.28, 0.38);
    const minX = left + paddingX;
    const maxX = left + width - paddingX;
    const minY = top + paddingY;
    const maxY = top + height - paddingY;
    const centerY = randomBetween(minY + (maxY - minY) * 0.25, maxY - (maxY - minY) * 0.2);
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const waveCount = Math.floor(randomBetween(2, 4));
    const mainPoints: Stroke = [];
    const totalPoints = Math.floor(randomBetween(22, 34));

    for (let index = 0; index < totalPoints; index += 1) {
      const ratio = index / (totalPoints - 1);
      const wave = Math.sin(ratio * Math.PI * waveCount * 2 + randomBetween(-0.12, 0.12));
      const drift = Math.sin(ratio * Math.PI) * randomBetween(-0.16, 0.16);
      mainPoints.push([
        clamp(minX + ratio * spanX + randomBetween(-spanX * 0.015, spanX * 0.015), minX, maxX),
        clamp(
          centerY + wave * spanY * randomBetween(0.22, 0.36) + drift * spanY,
          minY,
          maxY
        ),
      ]);
    }

    const strokes: Stroke[] = [mainPoints];

    if (Math.random() > 0.25) {
      const start = mainPoints[Math.floor(mainPoints.length * randomBetween(0.12, 0.28))];
      const end: Point = [
        clamp(start[0] + spanX * randomBetween(0.16, 0.28), minX, maxX),
        clamp(start[1] - spanY * randomBetween(0.18, 0.34), minY, maxY),
      ];
      const control: Point = [
        (start[0] + end[0]) / 2 + spanX * randomBetween(-0.08, 0.08),
        Math.min(start[1], end[1]) - spanY * randomBetween(0.12, 0.24),
      ];
      const accentPointCount = Math.floor(randomBetween(12, 20));
      strokes.push(
        Array.from({ length: accentPointCount }, (_, index) =>
          quadraticPoint(start, control, end, index / (accentPointCount - 1))
        )
      );
    }

    if (Math.random() > 0.35) {
      const start = mainPoints[Math.floor(mainPoints.length * randomBetween(0.68, 0.86))];
      const end: Point = [
        clamp(start[0] + spanX * randomBetween(0.08, 0.18), minX, maxX),
        clamp(start[1] + spanY * randomBetween(0.16, 0.3), minY, maxY),
      ];
      const control: Point = [
        start[0] + spanX * randomBetween(0.06, 0.12),
        start[1] + spanY * randomBetween(0.04, 0.12),
      ];
      const tailPointCount = Math.floor(randomBetween(10, 18));
      strokes.push(
        Array.from({ length: tailPointCount }, (_, index) =>
          quadraticPoint(start, control, end, index / (tailPointCount - 1))
        )
      );
    }

    return strokes;
  };

  const fireStrokeEvents = async (target: HTMLElement): Promise<void> => {
    const strokes = createSignatureStrokes(target);
    let pointerId = Date.now() % 100000;

    for (const stroke of strokes) {
      pointerId += 1;
      const pressure = randomBetween(STROKE_LIMITS.pressureMin, STROKE_LIMITS.pressureMax);
      const firstPoint = stroke[0];
      const lastPoint = stroke[stroke.length - 1];

      dispatchStrokeEvent("start", target, firstPoint[0], firstPoint[1], pointerId, pressure);
      await wait(randomBetween(20, 45));

      for (const point of stroke.slice(1, -1)) {
        dispatchStrokeEvent(
          "move",
          target,
          point[0],
          point[1],
          pointerId,
          randomBetween(STROKE_LIMITS.pressureMin, STROKE_LIMITS.pressureMax)
        );
        await wait(randomBetween(STROKE_LIMITS.moveDelayMin, STROKE_LIMITS.moveDelayMax));
      }

      dispatchStrokeEvent("end", target, lastPoint[0], lastPoint[1], pointerId, 0);
      await wait(randomBetween(90, 180));
    }
  };

  const tryConfirmSignature = async (): Promise<boolean> => {
    const confirm = findClickableByText(TEXT.signatureConfirm);
    if (!confirm) return false;
    clickElement(confirm);
    await wait(800);
    return true;
  };

  const drawOneSignature = async (): Promise<boolean> => {
    const positionCount = await focusNextSignature();
    const signEntry = findSignatureImageEntry();

    if (!signEntry) {
      return positionCount <= 0;
    }

    clickElement(signEntry);
    await wait(1000);
    await fireStrokeEvents(topSignTarget());
    await wait(500);
    await tryConfirmSignature();
    await wait(800);
    return true;
  };

  const submitSignedDocuments = async (): Promise<boolean> => {
    let submit = findClickableByText(TEXT.submit);

    if (!submit) {
      await waitUntil(
        "submit signature button",
        () => Boolean(findClickableByText(TEXT.submit)),
        SIGN_LIMITS.submitButtonTimeout,
        300
      );
      submit = findClickableByText(TEXT.submit);
    }

    if (!submit) return false;

    clickElement(submit);
    await wait(1000);
    await tryConfirmSignature();
    await wait(SIGN_LIMITS.submitSettleDelay);
    return true;
  };

  const waitForManualSignaturesComplete = async (): Promise<void> => {
    const startTime = Date.now();

    while (Date.now() - startTime < SIGN_LIMITS.manualSignatureTimeout) {
      if (getPositionCount() <= 0) {
        return;
      }

      await wait(1000);
    }

    throw new Error(
      `人工签字等待超时，仍有未完成签字数量：${getPositionCount()}`
    );
  };


  const waitUntil = async (
    description: string,
    predicate: () => boolean | Promise<boolean>,
    timeout: number = 20000,
    interval: number = 200
  ): Promise<void> => {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (await predicate()) return;
      await wait(interval);
    }

    throw new Error(`Wait timeout: ${description}`);
  };

  const isTopFrame = (): boolean => window.top === window;

  const hasManualSignatureSuccess = (): boolean => {
    return queryAll<HTMLElement>("uni-modal, .uni-modal")
      .filter(isVisible)
      .some((element) => {
        const text = getElementText(element);
        return text.includes("签字成功");
      });
  };

  const waitForManualSignatureSuccess = async (): Promise<void> => {
    await waitUntil(
      "manual signature success",
      hasManualSignatureSuccess,
      SIGN_LIMITS.manualSuccessTimeout,
      500
    );
  };

  const waitForSignPageReady = async (): Promise<void> => {
    if (
      document.querySelector("iframe") &&
      !findPositionButton() &&
      !findClickableByText(TEXT.submit)
    ) {
      throw new Error(`当前 frame 是签字容器页，跳过等待：${location.href}`);
    }

    await waitUntil(
      "sign page ready",
      () => Boolean(findPositionButton() || findClickableByText(TEXT.submit)),
      SIGN_LIMITS.pageReadyTimeout,
      300
    );
  };

  return (async () => {
    try {
      await wait(SIGN_LIMITS.initialDelay);

      if (signatureMode === "manual") {
        if (!isTopFrame()) {
          return {
            success: false,
            errorMessage: `Skip child frame in manual mode: ${location.href}`,
          };
        }

        await waitForManualSignatureSuccess();
        return { success: true };
      }

      await waitForSignPageReady();
      const initialCount = getPositionCount();
      if (!findPositionButton() && initialCount <= 0) {
        return {
          success: false,
          errorMessage: `当前 frame 没有瞄准按钮：${location.href}`,
        };
      }

      let signedCount = 0;
      let previousCount = initialCount;
      for (let index = 0; index < SIGN_LIMITS.maxSignaturePositions; index += 1) {
        if (previousCount <= 0) break;
        if (!(await drawOneSignature())) break;
        signedCount += 1;
        previousCount = await waitForPositionCountBelow(previousCount);
      }

      if (!signedCount && getPositionCount() > 0) {
        throw new Error(`没有找到可点击的签字入口：${location.href}`);
      }

      if (getPositionCount() > 0) {
        throw new Error(`仍有未完成签字数量：${getPositionCount()}`);
      }

      if (!(await submitSignedDocuments())) {
        throw new Error(`没有找到提交签署按钮：${location.href}`);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  })();
}
