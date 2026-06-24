import type {
  AutoSignatureMode,
  OpenMobileSignPagePayload,
  RequestAction,
  ResponseResult,
  SignatureMedianEntry,
  SignatureMode,
} from "@/types";

const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const DEBUGGER_VERSION = "1.3";
const MOBILE_VIEWPORT = {
  width: 768,
  height: 768,
  deviceScaleFactor: 3,
};
const SIGN_PAGE_LOAD_TIMEOUT = 30000;

type MobileSignScriptResult =
  | { success: true }
  | { success: false; errorMessage: string };

type MobileSignFrameProbe = {
  href: string;
  isTopFrame: boolean;
  hasIframe: boolean;
  hasPositionButton: boolean;
  positionCount: number;
  hasSubmit: boolean;
  hasSuccess: boolean;
  hasSignatureEntry: boolean;
  hasSignatureBoard: boolean;
};

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

function probeMobileSignFrame(): MobileSignFrameProbe {
  const normalizeText = (text?: string | null) => (text || "").replace(/\s+/g, "");
  const getElementWindow = (element: Element) => element.ownerDocument.defaultView || window;
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
  const queryAll = <T extends Element>(selector: string): T[] =>
    Array.from(document.querySelectorAll<T>(selector));
  const getElementText = (element: Element) => normalizeText(element.textContent || "");
  const findClickableByText = (texts: string[]): HTMLElement | undefined => {
    const normalizedTexts = texts.map(normalizeText);
    const candidates = queryAll<HTMLElement>("button, .van-button, [role='button'], a, div, span")
      .filter(isVisible);

    return candidates.find((candidate) => {
      const text = getElementText(candidate);
      return normalizedTexts.some((item) => text.includes(item));
    });
  };
  const positionButton = queryAll<HTMLElement>(".ax-pdf-overlay-position-btn")
    .find(isVisible);
  const wrapper = positionButton?.parentElement;
  const countText =
    wrapper?.querySelector<HTMLElement>(".ax-pdf-overlay-count")?.textContent ||
    wrapper?.textContent ||
    "";
  const count = Number.parseInt(countText.replace(/[^\d]/g, ""), 10);
  const hasSignatureEntry = queryAll<HTMLElement>(
    ".overlay-elem.required.overlay-elem-img, .img-sign-wrapper, [class*='img-sign'], [class*='sign-wrapper'], [class*='signWrapper'], .element-wrapper"
  ).some((element) => {
    const text = getElementText(element);
    const className = element.className.toString();
    return (
      isVisible(element) &&
      (text.includes("签字") ||
        text.includes("签名") ||
        className.includes("overlay-elem-img") ||
        className.includes("sign") ||
        !!element.querySelector("img"))
    );
  });
  const hasSignatureBoard = queryAll<HTMLElement>(
    ".listener, .ax-sign-free-svg, .ax-sign-svg, .ax-writing-board-content .view, .ax-writing-board-content"
  ).some((element) => {
    const rect = element.getBoundingClientRect();
    return isVisible(element) && rect.width >= 20 && rect.height >= 20;
  });

  return {
    href: location.href,
    isTopFrame: window.top === window,
    hasIframe: Boolean(document.querySelector("iframe")),
    hasPositionButton: Boolean(positionButton),
    positionCount: Number.isFinite(count) ? count : 0,
    hasSubmit: Boolean(findClickableByText(["提交签署", "提交签字", "提交"])),
    hasSuccess: queryAll<HTMLElement>("uni-modal, .uni-modal")
      .filter(isVisible)
      .some((element) => getElementText(element).includes("签字成功")),
    hasSignatureEntry,
    hasSignatureBoard,
  };
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

async function probeMobileSignFrames(tabId: number): Promise<
  Array<MobileSignFrameProbe & { frameId: number }>
> {
  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: probeMobileSignFrame,
  });

  return results.map((result) => ({
    ...((result.result || {}) as MobileSignFrameProbe),
    frameId: (result as unknown as { frameId?: number }).frameId ?? 0,
  }));
}

function pickMobileSignFrame(
  probes: Array<MobileSignFrameProbe & { frameId: number }>
): (MobileSignFrameProbe & { frameId: number }) | undefined {
  return probes
    .filter((probe) => {
      return (
        probe.hasPositionButton ||
        probe.hasSignatureEntry ||
        probe.hasSignatureBoard ||
        probe.hasSubmit
      );
    })
    .sort((left, right) => {
      const score = (probe: MobileSignFrameProbe) => {
        if (probe.hasPositionButton && probe.positionCount > 0) return 0;
        if (probe.hasSignatureEntry) return 1;
        if (probe.hasSignatureBoard) return 2;
        if (probe.hasSubmit) return 3;
        return 4;
      };

      return score(left) - score(right);
    })[0];
}

function summarizeMobileSignFrames(
  probes: Array<MobileSignFrameProbe & { frameId: number }>
): string {
  return probes
    .map((probe) => {
      return [
        `frame=${probe.frameId}`,
        probe.isTopFrame ? "top" : "child",
        `count=${probe.positionCount}`,
        `position=${probe.hasPositionButton}`,
        `entry=${probe.hasSignatureEntry}`,
        `board=${probe.hasSignatureBoard}`,
        `submit=${probe.hasSubmit}`,
        `success=${probe.hasSuccess}`,
        `iframe=${probe.hasIframe}`,
        probe.href,
      ].join(",");
    })
    .join(" | ");
}

async function getMobileSignScriptTarget(
  tabId: number,
  signatureMode: SignatureMode
): Promise<{ tabId: number; frameIds: number[] }> {
  if (signatureMode === "manual") {
    return { tabId, frameIds: [0] };
  }

  const startTime = Date.now();
  let latestProbes: Array<MobileSignFrameProbe & { frameId: number }> = [];

  while (Date.now() - startTime < SIGN_PAGE_LOAD_TIMEOUT) {
    latestProbes = await probeMobileSignFrames(tabId);
    const targetFrame = pickMobileSignFrame(latestProbes);

    if (targetFrame) {
      console.log(
        "移动端签字脚本命中 frame",
        targetFrame.frameId,
        summarizeMobileSignFrames(latestProbes)
      );
      return { tabId, frameIds: [targetFrame.frameId] };
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `移动端签字页面没有找到可执行 frame：${summarizeMobileSignFrames(latestProbes)}`
  );
}

async function waitForMobileSignatureSuccess(tabId: number): Promise<void> {
  const startTime = Date.now();
  let latestProbes: Array<MobileSignFrameProbe & { frameId: number }> = [];

  while (Date.now() - startTime < 10 * 60 * 1000) {
    latestProbes = await probeMobileSignFrames(tabId);

    if (latestProbes.some((probe) => probe.hasSuccess)) {
      console.log("移动端签字成功弹窗已出现", summarizeMobileSignFrames(latestProbes));
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `等待移动端签字成功弹窗超时：${summarizeMobileSignFrames(latestProbes)}`
  );
}

async function executeMobileSignScript(
  tabId: number,
  signatureMode: SignatureMode,
  signatureNames: string[],
  autoSignatureMode: AutoSignatureMode,
  signatureMedians: SignatureMedianEntry[]
): Promise<void> {
  const target = await getMobileSignScriptTarget(tabId, signatureMode);
  const results = await browser.scripting.executeScript({
    target,
    func: mobileSignAutomation,
    args: [signatureMode, signatureNames, autoSignatureMode, signatureMedians],
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
    await executeMobileSignScript(
      tab.id,
      payload.signatureMode || "auto",
      payload.signatureNames || [],
      payload.autoSignatureMode || "hanzi-medians",
      payload.signatureMedians || []
    );
    await waitForMobileSignatureSuccess(tab.id);
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
  signatureMode: "manual" | "auto" = "auto",
  signatureNames: string[] = [],
  autoSignatureMode: "hanzi-medians" = "hanzi-medians",
  signatureMedians: Array<{
    name: string;
    chars: string[];
    dataByChar: Record<string, { medians: Array<Array<[number, number]>> }>;
  }> = []
): Promise<MobileSignScriptResult> {
  type ShapePoint = { x: number; y: number };
  type HanziMedian = Array<[number, number]>;
  type HanziData = { medians: HanziMedian[] };
  type EventWindow = Window & typeof globalThis;
  type StrokeEventType = "start" | "move" | "end";
  type PlaybackPoint = ShapePoint & { delay: number };
  type PlaybackStroke = {
    char: string;
    charIndex: number;
    points: PlaybackPoint[];
    pauseAfter: number;
    length: number;
  };

  const HANZI_SPACE = 1024;
  const BASE_POINT_STEP = 6;
  const BASE_MOVE_DELAY = 8;
  const HUMAN_STRENGTH = 0.65;

  const SELECTORS = {
    positionButton: ".ax-pdf-overlay-position-btn",
    positionCount: ".ax-pdf-overlay-count",
    focusedSignature: ".overlay-elem.required.overlay-elem-img.focus",
    signatureEntry:
      ".overlay-elem.required.overlay-elem-img, .img-sign-wrapper, [class*='img-sign'], [class*='sign-wrapper'], [class*='signWrapper'], .element-wrapper",
    signatureBoard:
      ".listener, .ax-sign-free-svg, .ax-sign-svg, .ax-writing-board-content .view, .ax-writing-board-content",
    signatureContainer:
      ".van-popup, .van-dialog, .signature, .sign, [class*='sign'], [class*='Signature'], .h5-sign-board, .signView, .sign-view",
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
    pageReadyTimeout: 90000,
    manualSignatureTimeout: 10 * 60 * 1000,
    manualSuccessTimeout: 10 * 60 * 1000,
    submitButtonTimeout: 15000,
    submitSettleDelay: 1000,
    initialDelay: 1500,
  };

  const wait = (duration: number) =>
    new Promise((resolve) => window.setTimeout(resolve, duration));

  const normalizeText = (text?: string | null) => (text || "").replace(/\s+/g, "");

  const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

  const randomBetween = (random: () => number, min: number, max: number): number =>
    min + (max - min) * random();

  const hashString = (value: string): number => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };

  const createRandom = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  };

  const pointDistance = (left: ShapePoint, right: ShapePoint): number =>
    Math.hypot(right.x - left.x, right.y - left.y);

  const strokeLength = (points: ShapePoint[]): number => {
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      length += pointDistance(points[index - 1], points[index]);
    }
    return length;
  };

  const angleChange = (
    previous: ShapePoint | undefined,
    current: ShapePoint,
    next: ShapePoint | undefined
  ): number => {
    if (!previous || !next) return 0;
    const ax = current.x - previous.x;
    const ay = current.y - previous.y;
    const bx = next.x - current.x;
    const by = next.y - current.y;
    const leftLength = Math.hypot(ax, ay);
    const rightLength = Math.hypot(bx, by);
    if (!leftLength || !rightLength) return 0;
    const cosine = clamp((ax * bx + ay * by) / (leftLength * rightLength), -1, 1);
    return Math.acos(cosine);
  };

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

  const clickElement = (element: HTMLElement) => {
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const elementWindow = getElementWindow(element);

    if (typeof elementWindow.PointerEvent === "function") {
      for (const type of ["pointerdown", "pointerup"]) {
        element.dispatchEvent(
          new elementWindow.PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            pointerId: 1,
            pointerType: "pen",
            isPrimary: true,
            pressure: type === "pointerup" ? 0 : 0.45,
          })
        );
      }
    }

    for (const type of ["mousedown", "mouseup", "click"]) {
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

  const findSignatureBoardTarget = (): HTMLElement | undefined => {
    const boardCandidates = queryAll<HTMLElement>(SELECTORS.signatureBoard)
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const className = element.className.toString();
        const isListener = className.split(/\s+/).includes("listener");
        const isSvgBoard =
          className.includes("ax-sign-free-svg") || className.includes("ax-sign-svg");

        return {
          element,
          rect,
          priority: isListener ? 0 : isSvgBoard ? 1 : 2,
        };
      })
      .filter(({ rect }) => rect.width >= 20 && rect.height >= 20)
      .sort((left, right) => {
        const leftArea = left.rect.width * left.rect.height;
        const rightArea = right.rect.width * right.rect.height;
        return left.priority - right.priority || rightArea - leftArea;
      });

    return boardCandidates[0]?.element;
  };

  const topSignTarget = (): HTMLElement => {
    const board = findSignatureBoardTarget();
    if (board) return board;

    const dialog = queryAll<HTMLElement>(SELECTORS.signatureContainer)
      .filter(isVisible)
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
      })[0];

    return dialog || findPositionButton()?.ownerDocument.body || document.body;
  };

  const getTargetDrawingBox = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const minX = rect.left + rect.width * 0.12;
    const maxX = rect.left + rect.width * 0.88;
    const centerY = rect.top + rect.height * 0.46;
    const safeHeight = rect.height * 0.22;

    return {
      minX,
      maxX,
      minY: centerY - safeHeight / 2,
      maxY: centerY + safeHeight / 2,
    };
  };

  const getPointBounds = (strokes: Array<{ points: ShapePoint[] }>) => {
    const points = strokes.flatMap((stroke) => stroke.points);
    return points.reduce(
      (bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        maxX: Math.max(bounds.maxX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxY: Math.max(bounds.maxY, point.y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    );
  };

  const layoutHanziMedians = (
    target: HTMLElement,
    entries: Array<{ char: string; data: HanziData }>,
    random: () => number,
    humanStrength: number
  ) => {
    const gapRatio = 0.08;
    const rawStrokes: Array<{ char: string; charIndex: number; points: ShapePoint[] }> = [];
    const charLayouts = entries.map((entry, charIndex) => {
      const sizeNoise = (random() - 0.5) * 0.06 * humanStrength;
      const baselineNoise = (random() - 0.5) * 44 * humanStrength;
      const gapNoise = charIndex < entries.length - 1 ? (random() - 0.5) * 90 * humanStrength : 0;

      return {
        entry,
        charIndex,
        size: HANZI_SPACE * (1 + sizeNoise),
        baseline: baselineNoise,
        gapAfter: HANZI_SPACE * gapRatio + gapNoise,
      };
    });

    let cursorX = 0;
    for (const { entry, charIndex, size, baseline, gapAfter } of charLayouts) {
      const scale = size / HANZI_SPACE;
      for (const median of entry.data.medians) {
        rawStrokes.push({
          char: entry.char,
          charIndex,
          points: median.map(([x, y]) => ({
            x: cursorX + x * scale,
            y: (HANZI_SPACE - y) * scale + baseline,
          })),
        });
      }
      cursorX += size + gapAfter;
    }

    const sourceBounds = getPointBounds(rawStrokes);
    const sourceWidth = Math.max(1, sourceBounds.maxX - sourceBounds.minX);
    const sourceHeight = Math.max(1, sourceBounds.maxY - sourceBounds.minY);
    const box = getTargetDrawingBox(target);
    const targetWidth = Math.max(1, box.maxX - box.minX);
    const targetHeight = Math.max(1, box.maxY - box.minY);
    const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight) * 0.94;
    const fittedWidth = sourceWidth * scale;
    const fittedHeight = sourceHeight * scale;
    const offsetX = box.minX + (targetWidth - fittedWidth) / 2;
    const offsetY = box.minY + (targetHeight - fittedHeight) / 2;

    return rawStrokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({
        x: clamp(offsetX + (point.x - sourceBounds.minX) * scale, box.minX, box.maxX),
        y: clamp(offsetY + (point.y - sourceBounds.minY) * scale, box.minY, box.maxY),
      })),
    }));
  };

  const resampleStrokeDynamic = (points: ShapePoint[], baseStep: number): ShapePoint[] => {
    if (points.length <= 1) return points;
    const totalLength = strokeLength(points);
    const lengthFactor =
      totalLength > 150 ? 0.72 : totalLength > 90 ? 0.86 : totalLength < 38 ? 1.45 : 1;
    const sampled = [points[0]];

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const distance = pointDistance(previous, current);
      const curve = angleChange(points[index - 2], previous, current);
      const curveFactor = 1 - Math.min(0.38, (curve / Math.PI) * 0.7);
      const step = Math.max(2, baseStep * lengthFactor * curveFactor);
      const segments = Math.max(1, Math.ceil(distance / step));

      for (let segment = 1; segment <= segments; segment += 1) {
        const ratio = segment / segments;
        sampled.push({
          x: previous.x + (current.x - previous.x) * ratio,
          y: previous.y + (current.y - previous.y) * ratio,
        });
      }
    }

    return sampled;
  };

  const applyDirectionalJitter = (
    points: ShapePoint[],
    random: () => number,
    humanStrength: number
  ): ShapePoint[] => {
    if (humanStrength <= 0 || points.length <= 2) return points;
    const totalLength = strokeLength(points);
    const lengthRatio = clamp(totalLength / 170, 0, 1);
    const baseJitter = (0.3 + lengthRatio * 0.9) * humanStrength;

    return points.map((point, index) => {
      if (index === 0 || index === points.length - 1) {
        return point;
      }

      const previous = points[index - 1];
      const next = points[index + 1];
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const distance = Math.hypot(dx, dy) || 1;
      const tangentX = dx / distance;
      const tangentY = dy / distance;
      const normalX = -tangentY;
      const normalY = tangentX;
      const curve = angleChange(previous, point, next);
      const curveGuard = 1 - Math.min(0.55, curve / Math.PI);
      const endpointGuard = Math.sin((index / (points.length - 1)) * Math.PI);
      const amount = baseJitter * curveGuard * (0.45 + endpointGuard * 0.55);
      const normalNoise = randomBetween(random, -amount, amount);
      const tangentNoise = randomBetween(random, -amount * 0.28, amount * 0.28);

      return {
        x: point.x + normalX * normalNoise + tangentX * tangentNoise,
        y: point.y + normalY * normalNoise + tangentY * tangentNoise,
      };
    });
  };

  const enrichStrokeTiming = (
    strokes: Array<{ char: string; charIndex: number; points: ShapePoint[] }>,
    baseDelay: number,
    humanStrength: number
  ): PlaybackStroke[] => {
    return strokes.map((stroke, index) => {
      const points = stroke.points;
      const length = strokeLength(points);
      const next = strokes[index + 1];
      const nextSameChar = next && next.charIndex === stroke.charIndex;
      const pauseAfter = !next
        ? 0
        : nextSameChar
          ? Math.round((28 + Math.min(42, length * 0.12)) * (0.65 + humanStrength * 0.7))
          : Math.round((110 + Math.min(80, length * 0.2)) * (0.75 + humanStrength * 0.8));
      const minDelay = Math.max(0, baseDelay * 0.45);
      const maxDelay = baseDelay * (1.5 + humanStrength * 0.9);
      const playbackPoints = points.map((point, pointIndex) => {
        if (pointIndex === 0) {
          return { ...point, delay: 0 };
        }

        const ratio = pointIndex / Math.max(1, points.length - 1);
        const endSlowdown = Math.pow(Math.abs(ratio - 0.5) * 2, 1.7);
        const curve = angleChange(points[pointIndex - 2], points[pointIndex - 1], points[pointIndex]);
        const curveDelay = (curve / Math.PI) * baseDelay * 1.4 * humanStrength;

        return {
          ...point,
          delay: Math.round(minDelay + (maxDelay - minDelay) * endSlowdown + curveDelay),
        };
      });

      return {
        char: stroke.char,
        charIndex: stroke.charIndex,
        points: playbackPoints,
        pauseAfter,
        length: Math.round(length),
      };
    });
  };

  const createHanziSignatureStrokes = async (
    target: HTMLElement,
    name: string,
    signatureIndex: number
  ): Promise<PlaybackStroke[]> => {
    const entry = signatureMedians[signatureIndex];
    if (!entry) {
      throw new Error(`没有找到第 ${signatureIndex + 1} 个签名的 Hanzi medians 数据`);
    }

    const chars = Array.isArray(entry.chars)
      ? entry.chars.filter((char) => /\S/.test(char))
      : [...name.trim()].filter((char) => /\S/.test(char));
    if (!chars.length) {
      throw new Error("签名姓名为空，降级为人工签字");
    }

    const random = createRandom(hashString(`${chars.join("")}|hanzi-medians-v1`));
    const entries = chars.map((char) => {
      const data = entry.dataByChar?.[char];
      if (!data || !Array.isArray(data.medians) || !data.medians.length) {
        throw new Error(`没有找到“${char}”的 Hanzi medians 数据`);
      }
      return { char, data };
    });
    const pointStrokes = layoutHanziMedians(target, entries, random, HUMAN_STRENGTH)
      .map((stroke) => ({
        ...stroke,
        points: applyDirectionalJitter(
          resampleStrokeDynamic(stroke.points, BASE_POINT_STEP),
          random,
          HUMAN_STRENGTH
        ),
      }))
      .filter((stroke) => stroke.points.length > 1);

    if (!pointStrokes.length) {
      throw new Error(`没有生成有效 Hanzi medians 签名：${name}`);
    }

    return enrichStrokeTiming(pointStrokes, BASE_MOVE_DELAY, HUMAN_STRENGTH);
  };

  const dispatchStrokeEvent = (
    type: StrokeEventType,
    target: HTMLElement,
    point: ShapePoint,
    pointerId: number,
    force: number
  ): void => {
    const targetWindow = getElementWindow(target);
    const pointerType =
      type === "start" ? "pointerdown" : type === "move" ? "pointermove" : "pointerup";
    const mouseType =
      type === "start" ? "mousedown" : type === "move" ? "mousemove" : "mouseup";
    const touchType =
      type === "start" ? "touchstart" : type === "move" ? "touchmove" : "touchend";
    const touchPoint = {
      identifier: pointerId,
      target,
      clientX: point.x,
      clientY: point.y,
      pageX: point.x + targetWindow.scrollX,
      pageY: point.y + targetWindow.scrollY,
      screenX: point.x,
      screenY: point.y,
      radiusX: 0.2,
      radiusY: 0.2,
      rotationAngle: 0,
      force,
    };

    if (typeof targetWindow.PointerEvent === "function") {
      target.dispatchEvent(
        new targetWindow.PointerEvent(pointerType, {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          width: 0.2,
          height: 0.2,
          button: 0,
          buttons: type === "end" ? 0 : 1,
          pointerId,
          pointerType: "pen",
          isPrimary: true,
          pressure: type === "end" ? 0 : force,
        })
      );
    }

    target.dispatchEvent(
      new targetWindow.MouseEvent(mouseType, {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        button: 0,
        buttons: type === "end" ? 0 : 1,
      })
    );

    try {
      target.dispatchEvent(
        new targetWindow.TouchEvent(touchType, {
          bubbles: true,
          cancelable: true,
          touches: type === "end" ? [] : [new targetWindow.Touch(touchPoint)],
          targetTouches: type === "end" ? [] : [new targetWindow.Touch(touchPoint)],
          changedTouches: [new targetWindow.Touch(touchPoint)],
        })
      );
    } catch {
    }
  };

  const fireStrokeEvents = async (
    target: HTMLElement,
    strokes: PlaybackStroke[]
  ): Promise<void> => {
    let pointerId = Date.now() % 100000;

    for (const stroke of strokes) {
      pointerId += 1;
      const firstPoint = stroke.points[0];
      const lastPoint = stroke.points[stroke.points.length - 1];

      dispatchStrokeEvent("start", target, firstPoint, pointerId, 0.4);
      await wait(firstPoint.delay);

      for (const point of stroke.points.slice(1)) {
        dispatchStrokeEvent("move", target, point, pointerId, 0.5);
        if (point.delay > 0) {
          await wait(point.delay);
        }
      }

      await wait(12);
      dispatchStrokeEvent("end", target, lastPoint, pointerId, 0);
      if (stroke.pauseAfter > 0) {
        await wait(stroke.pauseAfter);
      }
    }
  };

  const tryConfirmSignature = async (): Promise<boolean> => {
    const confirm = findClickableByText(TEXT.signatureConfirm);
    if (!confirm) return false;
    clickElement(confirm);
    await wait(800);
    return true;
  };

  const drawOneSignature = async (
    signatureIndex: number
  ): Promise<"signed" | "manualFallback" | "done"> => {
    const positionCount = await focusNextSignature();
    const signEntry = findSignatureImageEntry();

    if (!signEntry && !findSignatureBoardTarget()) {
      return positionCount <= 0 ? "done" : "manualFallback";
    }

    if (signEntry) {
      clickElement(signEntry);
    }

    await waitUntil(
      "signature drawing board",
      () => Boolean(findSignatureBoardTarget()),
      5000,
      100
    ).catch(async () => {
      await wait(600);
    });
    const signTarget = topSignTarget();
    const signatureName = signatureNames[signatureIndex] || "";

    try {
      const strokes = await createHanziSignatureStrokes(
        signTarget,
        signatureName,
        signatureIndex
      );
      await fireStrokeEvents(signTarget, strokes);
    } catch (error) {
      console.warn("Hanzi medians 自动签字失败，降级为人工签字", error);
      return "manualFallback";
    }

    await wait(500);
    await tryConfirmSignature();
    await wait(800);
    return "signed";
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
    if (!hasManualSignatureSuccess()) {
      await tryConfirmSignature();
    }
    await wait(SIGN_LIMITS.submitSettleDelay);
    return true;
  };

  const submitSignedDocumentsOrThrow = async (): Promise<void> => {
    const submitted = await submitSignedDocuments();

    if (!submitted) {
      throw new Error("没有找到提交签署按钮");
    }
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
        console.log(text);
        return text.includes("成功");
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

  const hasSignPageReadySignal = (): boolean =>
    Boolean(
      findPositionButton() ||
        findClickableByText(TEXT.submit) ||
        findSignatureImageEntry() ||
        findSignatureBoardTarget()
    );

  const isFrameContainerWithoutSignDom = (): boolean =>
    Boolean(document.querySelector("iframe")) && !hasSignPageReadySignal();

  const waitForSignPageReady = async (): Promise<"ready" | "skipFrame"> => {
    if (isFrameContainerWithoutSignDom()) {
      return "skipFrame";
    }
    console.log("移动端签字页等待就绪", location.href);
    await waitUntil(
      "sign page ready",
      hasSignPageReadySignal,
      SIGN_LIMITS.pageReadyTimeout,
      300
    );

    console.log("移动端签字页已就绪", {
      href: location.href,
      positionCount: getPositionCount(),
      hasPositionButton: Boolean(findPositionButton()),
      hasSubmit: Boolean(findClickableByText(TEXT.submit)),
    });

    return "ready";
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

      const pageReadyStatus = await waitForSignPageReady();
      if (pageReadyStatus === "skipFrame") {
        return {
          success: false,
          errorMessage: `Skip sign container frame: ${location.href}`,
        };
      }

      if (autoSignatureMode !== "hanzi-medians") {
        throw new Error(`不支持的自动签名模式：${autoSignatureMode}`);
      }

      const initialCount = getPositionCount();
      if (!findPositionButton() && initialCount <= 0 && !findClickableByText(TEXT.submit)) {
        return {
          success: false,
          errorMessage: `当前 frame 没有瞄准按钮：${location.href}`,
        };
      }

      let signedCount = 0;
      let previousCount = initialCount;
      for (let index = 0; index < SIGN_LIMITS.maxSignaturePositions; index += 1) {
        if (previousCount <= 0) break;
        const signResult = await drawOneSignature(index);
        if (signResult === "done") break;
        if (signResult === "manualFallback") {
          await waitForManualSignaturesComplete();
          await submitSignedDocumentsOrThrow();
          return { success: true };
        }
        signedCount += 1;
        previousCount = await waitForPositionCountBelow(previousCount);
      }

      if (!signedCount && getPositionCount() > 0) {
        throw new Error(`没有找到可点击的签字入口：${location.href}`);
      }

      if (getPositionCount() > 0) {
        throw new Error(`仍有未完成签字数量：${getPositionCount()}`);
      }

      await submitSignedDocumentsOrThrow();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  })();
}
