import type {
  AutoSignatureMode,
  OpenMobileSignPagePayload,
  RequestAction,
  ResponseResult,
  SignatureFontConfig,
  SignatureMode,
  SkeletonSignatureConfig,
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
  signatureMode: SignatureMode,
  signatureNames: string[],
  signatureFonts: SignatureFontConfig[],
  skeletonConfig: SkeletonSignatureConfig,
  autoSignatureMode: AutoSignatureMode
): Promise<void> {
  if (signatureMode === "auto") {
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["opentype.min.js"],
    });
  }

  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: mobileSignAutomation,
    args: [
      signatureMode,
      signatureNames,
      signatureFonts,
      skeletonConfig,
      autoSignatureMode,
    ],
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
    const signatureFonts = (payload.signatureFonts || []).map((font) => ({
      ...font,
      path: /^https?:\/\//.test(font.path)
        ? font.path
        : browser.runtime.getURL(font.path.replace(/^\/+/, "") as any),
    }));
    await executeMobileSignScript(
      tab.id,
      payload.signatureMode || "auto",
      payload.signatureNames || [],
      signatureFonts,
      payload.skeletonConfig || {
        fontSize: 240,
        scaleX: 84,
        slant: 17,
        sampleDensity: 8,
        jitter: 1,
      },
      payload.autoSignatureMode || "skeleton-strokes"
    );
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
  signatureFonts: Array<{ name: string; path: string }> = [],
  skeletonConfig: {
    fontSize: number;
    scaleX: number;
    slant: number;
    sampleDensity: number;
    jitter: number;
  } = {
    fontSize: 240,
    scaleX: 84,
    slant: 17,
    sampleDensity: 8,
    jitter: 1,
  },
  autoSignatureMode: "skeleton-strokes" = "skeleton-strokes"
): Promise<
  MobileSignScriptResult
> {
  type Point = [number, number];
  type ShapePoint = { x: number; y: number };
  type Stroke = Point[];
  type StrokeEventType = "start" | "move" | "end";
  type EventWindow = Window & typeof globalThis;
  type OpenTypeFont = {
    charToGlyph(char: string): { index?: number };
    getPath(text: string, x: number, y: number, fontSize: number): {
      commands: Array<Record<string, number | string>>;
    };
  };
  type OpenTypeApi = {
    parse(buffer: ArrayBuffer): OpenTypeFont;
  };

  const SELECTORS = {
    positionButton: ".ax-pdf-overlay-position-btn",
    positionCount: ".ax-pdf-overlay-count",
    focusedSignature: ".overlay-elem.required.overlay-elem-img.focus",
    signatureEntry:
      ".overlay-elem.required.overlay-elem-img, .img-sign-wrapper, [class*='img-sign'], [class*='sign-wrapper'], [class*='signWrapper'], .element-wrapper",
    signatureBoard:
      ".ax-sign-free-svg, .ax-sign-svg, .ax-writing-board-content .view, .ax-writing-board-content",
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
    initialDelay: 3000,
  };
  const STROKE_LIMITS = {
    pressureMin: 0.01,
    pressureMax: 0.05,
    moveDelayMin: 3,
    moveDelayMax: 8,
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

  const findSignatureBoardTarget = (): HTMLElement | undefined => {
    // 第一步：优先选择 SDK 真正接收笔迹事件的 SVG 节点。
    const boardCandidates = queryAll<HTMLElement>(SELECTORS.signatureBoard)
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const className = element.className.toString();
        const isSvgBoard =
          className.includes("ax-sign-free-svg") || className.includes("ax-sign-svg");

        return {
          element,
          rect,
          priority: isSvgBoard ? 0 : 1,
        };
      })
      .filter(({ rect }) => rect.width >= 20 && rect.height >= 20)
      .sort((left, right) => {
        // 第二步：同等优先级下选择面积更大的可见签字板，避免选到内部碎片节点。
        const leftArea = left.rect.width * left.rect.height;
        const rightArea = right.rect.width * right.rect.height;
        return left.priority - right.priority || rightArea - leftArea;
      });

    return boardCandidates[0]?.element;
  };

  const topSignTarget = (): HTMLElement => {
    // 第一步：如果页面已打开 SDK 签字板，直接使用真实签字板作为坐标参照。
    const board = findSignatureBoardTarget();
    if (board) return board;

    // 第二步：找不到 SDK 签字板时，保留旧的宽泛容器作为兜底。
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
    const pointerType =
      type === "start" ? "pointerdown" : type === "move" ? "pointermove" : "pointerup";
    const mouseType =
      type === "start" ? "mousedown" : type === "move" ? "mousemove" : "mouseup";

    // 第一步：签字 SDK 会用事件目标 SVG 的 CTM/边界计算坐标，因此事件必须直接派发给真实签字板。
    if (typeof targetWindow.PointerEvent === "function") {
      target.dispatchEvent(
        new targetWindow.PointerEvent(pointerType, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
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
      return;
    }

    // 第二步：极少数环境没有 PointerEvent 时，退回到鼠标事件，避免完全无法签字。
    target.dispatchEvent(
      new targetWindow.MouseEvent(mouseType, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: type === "end" ? 0 : 1,
      })
    );
  };

  const CANVAS_SPACE = 1000;
  const VIRTUAL_CANVAS = {
    width: 960,
    height: 360,
  };
  const fontCache = new Map<string, OpenTypeFont>();

  const getOpenType = (): OpenTypeApi => {
    const api = (window as unknown as { opentype?: OpenTypeApi }).opentype;
    if (!api) {
      throw new Error("opentype.js 未加载，无法生成字体骨架签名");
    }
    return api;
  };

  const loadFont = async (fontConfig: { name: string; path: string }): Promise<OpenTypeFont> => {
    const cached = fontCache.get(fontConfig.path);
    if (cached) return cached;

    const response = await fetch(fontConfig.path);
    if (!response.ok) {
      throw new Error(`字体加载失败：${fontConfig.name}`);
    }

    const font = getOpenType().parse(await response.arrayBuffer());
    fontCache.set(fontConfig.path, font);
    return font;
  };

  const fontSupportsName = (font: OpenTypeFont, name: string): boolean => {
    return Array.from(name).every((char) => {
      const glyph = font.charToGlyph(char);
      return glyph && glyph.index !== 0;
    });
  };

  const pickFontForName = async (name: string): Promise<OpenTypeFont> => {
    if (!name) {
      throw new Error("签名姓名为空，降级为人工签字");
    }

    if (!signatureFonts.length) {
      throw new Error("未配置签名字体，降级为人工签字");
    }

    const usableFonts: OpenTypeFont[] = [];
    for (const fontConfig of signatureFonts) {
      const font = await loadFont(fontConfig);
      if (fontSupportsName(font, name)) {
        usableFonts.push(font);
      }
    }

    if (!usableFonts.length) {
      throw new Error(`字体库缺少签名文字：${name}`);
    }

    return usableFonts[Math.floor(Math.random() * usableFonts.length)];
  };

  const commandPoint = (command: Record<string, number | string>, key: string): number =>
    Number(command[key] || 0);

  const cubicShapePoint = (
    start: ShapePoint,
    controlA: ShapePoint,
    controlB: ShapePoint,
    end: ShapePoint,
    ratio: number
  ): ShapePoint => {
    const inverse = 1 - ratio;
    return {
      x:
        inverse * inverse * inverse * start.x +
        3 * inverse * inverse * ratio * controlA.x +
        3 * inverse * ratio * ratio * controlB.x +
        ratio * ratio * ratio * end.x,
      y:
        inverse * inverse * inverse * start.y +
        3 * inverse * inverse * ratio * controlA.y +
        3 * inverse * ratio * ratio * controlB.y +
        ratio * ratio * ratio * end.y,
    };
  };

  const quadraticShapePoint = (
    start: ShapePoint,
    control: ShapePoint,
    end: ShapePoint,
    ratio: number
  ): ShapePoint => {
    const inverse = 1 - ratio;
    return {
      x: inverse * inverse * start.x + 2 * inverse * ratio * control.x + ratio * ratio * end.x,
      y: inverse * inverse * start.y + 2 * inverse * ratio * control.y + ratio * ratio * end.y,
    };
  };

  const pathToContours = (
    path: { commands: Array<Record<string, number | string>> },
    samplesPerCurve: number
  ): ShapePoint[][] => {
    const contours: ShapePoint[][] = [];
    let current: ShapePoint[] | null = null;
    let cursor: ShapePoint = { x: 0, y: 0 };
    let start: ShapePoint | null = null;

    for (const command of path.commands) {
      if (command.type === "M") {
        current = [{ x: commandPoint(command, "x"), y: commandPoint(command, "y") }];
        contours.push(current);
        cursor = current[0];
        start = cursor;
      } else if (command.type === "L" && current) {
        cursor = { x: commandPoint(command, "x"), y: commandPoint(command, "y") };
        current.push(cursor);
      } else if (command.type === "C" && current) {
        const end = { x: commandPoint(command, "x"), y: commandPoint(command, "y") };
        for (let index = 1; index <= samplesPerCurve; index += 1) {
          current.push(
            cubicShapePoint(
              cursor,
              { x: commandPoint(command, "x1"), y: commandPoint(command, "y1") },
              { x: commandPoint(command, "x2"), y: commandPoint(command, "y2") },
              end,
              index / samplesPerCurve
            )
          );
        }
        cursor = end;
      } else if (command.type === "Q" && current) {
        const end = { x: commandPoint(command, "x"), y: commandPoint(command, "y") };
        for (let index = 1; index <= samplesPerCurve; index += 1) {
          current.push(
            quadraticShapePoint(
              cursor,
              { x: commandPoint(command, "x1"), y: commandPoint(command, "y1") },
              end,
              index / samplesPerCurve
            )
          );
        }
        cursor = end;
      } else if (command.type === "Z" && current && start) {
        current.push({ ...start });
      }
    }

    return contours.filter((contour) => contour.length > 1);
  };

  const getShapeBounds = (contours: ShapePoint[][]) => {
    const points = contours.flat();
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

  const transformContours = (contours: ShapePoint[][]): ShapePoint[][] => {
    const bounds = getShapeBounds(contours);
    const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
    const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
    const padding = 52;
    const targetWidth = VIRTUAL_CANVAS.width - padding * 2;
    const targetHeight = VIRTUAL_CANVAS.height - padding * 2;
    const fitScale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const scaleX = skeletonConfig.scaleX / 100;
    const slant = skeletonConfig.slant / 100;
    const jitter = skeletonConfig.jitter;
    const fittedWidth = sourceWidth * fitScale * scaleX;
    const fittedHeight = sourceHeight * fitScale;
    const offsetX = (VIRTUAL_CANVAS.width - fittedWidth) / 2;
    const offsetY = (VIRTUAL_CANVAS.height - fittedHeight) / 2;

    return contours.map((contour, contourIndex) =>
      contour.map((point, pointIndex) => {
        const localX = (point.x - bounds.minX) * fitScale * scaleX;
        const localY = (point.y - bounds.minY) * fitScale;
        const baselineShift = (localY - fittedHeight * 0.52) * slant;
        const noiseSeed = Math.sin((contourIndex + 1) * 31.17 + (pointIndex + 1) * 17.43);
        const noise = noiseSeed * jitter;
        return {
          x: offsetX + localX + baselineShift + noise,
          y: offsetY + localY + noise * 0.45,
        };
      })
    );
  };

  const makeCanvasPath = (contours: ShapePoint[][]): Path2D => {
    const path = new Path2D();
    for (const contour of contours) {
      const first = contour[0];
      path.moveTo(first.x, first.y);
      for (const point of contour.slice(1)) {
        path.lineTo(point.x, point.y);
      }
      path.closePath();
    }
    return path;
  };

  const rasterizeContours = (contours: ShapePoint[][]) => {
    const scale = 0.75;
    const width = Math.ceil(VIRTUAL_CANVAS.width * scale);
    const height = Math.ceil(VIRTUAL_CANVAS.height * scale);
    const rasterCanvas = document.createElement("canvas");
    rasterCanvas.width = width;
    rasterCanvas.height = height;
    const rasterContext = rasterCanvas.getContext("2d");

    if (!rasterContext) {
      throw new Error("无法创建签名骨架栅格画布");
    }

    rasterContext.save();
    rasterContext.scale(scale, scale);
    rasterContext.fillStyle = "#000";
    rasterContext.fill(makeCanvasPath(contours));
    rasterContext.restore();

    const imageData = rasterContext.getImageData(0, 0, width, height);
    const pixels = new Uint8Array(width * height);

    for (let index = 0; index < pixels.length; index += 1) {
      pixels[index] = imageData.data[index * 4 + 3] > 20 ? 1 : 0;
    }

    return { pixels, width, height, scale };
  };

  const skeletonNeighborValues = (pixels: Uint8Array, width: number, x: number, y: number) => {
    const index = (nx: number, ny: number) => (pixels[ny * width + nx] ? 1 : 0);
    return [
      index(x, y - 1),
      index(x + 1, y - 1),
      index(x + 1, y),
      index(x + 1, y + 1),
      index(x, y + 1),
      index(x - 1, y + 1),
      index(x - 1, y),
      index(x - 1, y - 1),
    ];
  };

  const countTransitions = (neighbors: number[]): number => {
    let transitions = 0;
    for (let index = 0; index < neighbors.length; index += 1) {
      if (neighbors[index] === 0 && neighbors[(index + 1) % neighbors.length] === 1) {
        transitions += 1;
      }
    }
    return transitions;
  };

  const thinSkeletonPixels = (
    sourcePixels: Uint8Array,
    width: number,
    height: number
  ): Uint8Array => {
    const pixels = new Uint8Array(sourcePixels);
    const maxIterations = 80;
    let changed = true;
    let iteration = 0;

    while (changed && iteration < maxIterations) {
      changed = false;

      for (let pass = 0; pass < 2; pass += 1) {
        const toRemove: number[] = [];

        for (let y = 1; y < height - 1; y += 1) {
          for (let x = 1; x < width - 1; x += 1) {
            const pixelIndex = y * width + x;
            if (!pixels[pixelIndex]) continue;

            const neighbors = skeletonNeighborValues(pixels, width, x, y);
            const neighborCount = neighbors.reduce((sum, value) => sum + value, 0);
            const transitions = countTransitions(neighbors);
            const [p2, , p4, , p6, , p8] = neighbors;
            const passCondition =
              pass === 0
                ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0
                : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0;

            if (
              neighborCount >= 2 &&
              neighborCount <= 6 &&
              transitions === 1 &&
              passCondition
            ) {
              toRemove.push(pixelIndex);
            }
          }
        }

        if (toRemove.length) {
          changed = true;
          toRemove.forEach((pixelIndex) => {
            pixels[pixelIndex] = 0;
          });
        }
      }

      iteration += 1;
    }

    return pixels;
  };

  const getSkeletonNeighbors = (
    pixels: Uint8Array,
    width: number,
    height: number,
    x: number,
    y: number
  ): ShapePoint[] => {
    const neighbors: ShapePoint[] = [];

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (pixels[ny * width + nx]) {
          neighbors.push({ x: nx, y: ny });
        }
      }
    }

    return neighbors;
  };

  const traceSkeletonPixels = (
    pixels: Uint8Array,
    width: number,
    height: number,
    scale: number
  ): ShapePoint[][] => {
    const visitedEdges = new Set<string>();
    const key = (point: ShapePoint) => `${point.x},${point.y}`;
    const edgeKey = (leftPoint: ShapePoint, rightPoint: ShapePoint) => {
      const left = key(leftPoint);
      const right = key(rightPoint);
      return left < right ? `${left}|${right}` : `${right}|${left}`;
    };
    const points: ShapePoint[] = [];

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[y * width + x]) {
          points.push({ x, y });
        }
      }
    }

    const degreeOf = (point: ShapePoint) =>
      getSkeletonNeighbors(pixels, width, height, point.x, point.y).length;
    const starts = points
      .filter((point) => degreeOf(point) !== 2)
      .sort((left, right) => left.x - right.x || left.y - right.y);
    const allStarts = starts.length ? starts : points.sort((left, right) => left.x - right.x || left.y - right.y);
    const traced: ShapePoint[][] = [];

    const traceFrom = (start: ShapePoint, next: ShapePoint): ShapePoint[] => {
      const stroke = [start];
      let previous = start;
      let current: ShapePoint | undefined = next;
      visitedEdges.add(edgeKey(start, next));

      while (current) {
        stroke.push(current);
        const neighbors: ShapePoint[] = getSkeletonNeighbors(pixels, width, height, current.x, current.y)
          .filter((neighbor) => key(neighbor) !== key(previous))
          .filter((neighbor) => !visitedEdges.has(edgeKey(current!, neighbor)));

        if (neighbors.length !== 1) break;

        const following: ShapePoint = neighbors[0];
        visitedEdges.add(edgeKey(current, following));
        previous = current;
        current = following;
      }

      return stroke;
    };

    for (const start of allStarts) {
      const neighbors = getSkeletonNeighbors(pixels, width, height, start.x, start.y)
        .filter((neighbor) => !visitedEdges.has(edgeKey(start, neighbor)))
        .sort((left, right) => left.x - right.x || left.y - right.y);

      for (const neighbor of neighbors) {
        const stroke = traceFrom(start, neighbor);
        if (stroke.length > 2) {
          traced.push(stroke);
        }
      }
    }

    return traced.map((stroke) =>
      stroke.map((point) => ({
        x: point.x / scale,
        y: point.y / scale,
      }))
    );
  };

  const pointDistance = (left: ShapePoint, right: ShapePoint): number =>
    Math.hypot(left.x - right.x, left.y - right.y);

  const pointStrokeLength = (stroke: ShapePoint[]): number => {
    let length = 0;
    for (let index = 1; index < stroke.length; index += 1) {
      length += pointDistance(stroke[index - 1], stroke[index]);
    }
    return length;
  };

  const simplifyPointStroke = (stroke: ShapePoint[]): ShapePoint[] => {
    const simplified: ShapePoint[] = [];
    let previous: ShapePoint | null = null;
    const step = 2;

    stroke.forEach((point, index) => {
      if (
        index === 0 ||
        index === stroke.length - 1 ||
        !previous ||
        Math.hypot(point.x - previous.x, point.y - previous.y) >= step
      ) {
        simplified.push(point);
        previous = point;
      }
    });

    return simplified;
  };

  const pruneShortSkeletonStrokes = (strokes: ShapePoint[][]): ShapePoint[][] => {
    return strokes.filter((stroke) => stroke.length >= 4 && pointStrokeLength(stroke) >= 14);
  };

  const bridgeSkeletonStrokes = (strokes: ShapePoint[][]): ShapePoint[][] => {
    const maxBridgeDistance = 22;
    const merged = strokes.map((stroke) => [...stroke]);
    let changed = true;

    while (changed) {
      changed = false;

      outer: for (let leftIndex = 0; leftIndex < merged.length; leftIndex += 1) {
        const left = merged[leftIndex];
        const leftStart = left[0];
        const leftEnd = left[left.length - 1];

        for (let rightIndex = leftIndex + 1; rightIndex < merged.length; rightIndex += 1) {
          const right = merged[rightIndex];
          const rightStart = right[0];
          const rightEnd = right[right.length - 1];
          const candidates = [
            { distance: pointDistance(leftEnd, rightStart), stroke: [...left, ...right] },
            { distance: pointDistance(leftEnd, rightEnd), stroke: [...left, ...right.slice().reverse()] },
            { distance: pointDistance(leftStart, rightEnd), stroke: [...right, ...left] },
            { distance: pointDistance(leftStart, rightStart), stroke: [...right.slice().reverse(), ...left] },
          ].sort((a, b) => a.distance - b.distance);

          if (candidates[0].distance <= maxBridgeDistance) {
            merged[leftIndex] = candidates[0].stroke;
            merged.splice(rightIndex, 1);
            changed = true;
            break outer;
          }
        }
      }
    }

    return merged;
  };

  const getTargetDrawingBox = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const fallbackWidth = Math.min(window.innerWidth * 0.78, 360);
    const fallbackHeight = Math.min(window.innerHeight * 0.30, 170);
    const left = rect.width > 20 ? rect.left : (window.innerWidth - fallbackWidth) / 2;
    const top = rect.height > 20 ? rect.top : window.innerHeight * 0.36;
    const width = rect.width > 20 ? rect.width : fallbackWidth;
    const height = rect.height > 20 ? rect.height : fallbackHeight;
    const safeWidth = width * 0.74;
    const safeHeight = height * 0.18;
    const safeLeft = left + width * 0.10;
    const safeCenterY = top + height * 0.52;

    // 第一步：签字板是竖向显示区域，但签名需要横排，所以只使用中部一条较矮的安全带。
    return {
      minX: safeLeft,
      maxX: safeLeft + safeWidth,
      minY: safeCenterY - safeHeight / 2,
      maxY: safeCenterY + safeHeight / 2,
    };
  };

  const getPointStrokesBounds = (pointStrokes: ShapePoint[][]) => {
    const points = pointStrokes.flat();
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

  const pointStrokesToTargetStrokes = (
    target: HTMLElement,
    pointStrokes: ShapePoint[][]
  ): Stroke[] => {
    const box = getTargetDrawingBox(target);
    const sourceBounds = getPointStrokesBounds(pointStrokes);
    const sourceWidth = Math.max(1, sourceBounds.maxX - sourceBounds.minX);
    const sourceHeight = Math.max(1, sourceBounds.maxY - sourceBounds.minY);
    const targetWidth = Math.max(1, box.maxX - box.minX);
    const targetHeight = Math.max(1, box.maxY - box.minY);
    const widthScale = targetWidth / sourceWidth;
    const heightScale = targetHeight / sourceHeight;
    const scale = Math.min(widthScale, heightScale) * 0.86;
    const fittedWidth = sourceWidth * scale;
    const fittedHeight = sourceHeight * scale;
    const offsetX = box.minX + Math.max(0, (targetWidth - fittedWidth) * 0.03);
    const offsetY = box.minY + Math.max(0, (targetHeight - fittedHeight) * 0.5);

    // 第一步：所有点都夹在安全带内，避免 SDK 判断越界后提前结束笔画。
    return pointStrokes.map((stroke) =>
      stroke.map((point) => [
        clamp(offsetX + (point.x - sourceBounds.minX) * scale, box.minX, box.maxX),
        clamp(offsetY + (point.y - sourceBounds.minY) * scale, box.minY, box.maxY),
      ])
    );
  };

  const createSkeletonSignatureStrokes = async (
    target: HTMLElement,
    name: string
  ): Promise<Stroke[]> => {
    const font = await pickFontForName(name);

    const path = font.getPath(name, 0, skeletonConfig.fontSize, skeletonConfig.fontSize);
    const rawContours = pathToContours(path, skeletonConfig.sampleDensity);
    if (!rawContours.length) {
      throw new Error(`没有从字体中解析到签名轮廓：${name}`);
    }
    const contours = transformContours(rawContours);

    const raster = rasterizeContours(contours);
    const skeletonPixels = thinSkeletonPixels(raster.pixels, raster.width, raster.height);
    const traced = traceSkeletonPixels(skeletonPixels, raster.width, raster.height, raster.scale)
      .map(simplifyPointStroke);
    const pointStrokes = bridgeSkeletonStrokes(pruneShortSkeletonStrokes(traced))
      .map(simplifyPointStroke)
      .sort((left, right) => left[0].x - right[0].x || left[0].y - right[0].y)
      .filter((stroke) => stroke.length > 2);

    if (!pointStrokes.length) {
      throw new Error(`没有生成有效签名骨架：${name}`);
    }

    return pointStrokesToTargetStrokes(target, pointStrokes);
  };

  const fireStrokeEvents = async (target: HTMLElement, strokes: Stroke[]): Promise<void> => {
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

  const drawOneSignature = async (
    signatureIndex: number
  ): Promise<"signed" | "manualFallback" | "done"> => {
    const positionCount = await focusNextSignature();
    const signEntry = findSignatureImageEntry();

    if (!signEntry) {
      return positionCount <= 0 ? "done" : "manualFallback";
    }

    clickElement(signEntry);
    await waitUntil(
      "signature drawing board",
      () => Boolean(findSignatureBoardTarget()),
      5000,
      100
    ).catch(async () => {
      // 第一步：部分兜底页面没有 SDK 签字板类名，保留短暂等待后继续使用旧容器策略。
      await wait(600);
    });
    const signTarget = topSignTarget();
    const signatureName = signatureNames[signatureIndex] || "";
    const strokes = await createSkeletonSignatureStrokes(signTarget, signatureName);
    await fireStrokeEvents(signTarget, strokes);
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

      if (autoSignatureMode !== "skeleton-strokes") {
        throw new Error(`不支持的自动签名模式：${autoSignatureMode}`);
      }

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
        const signResult = await drawOneSignature(index);
        if (signResult === "done") break;
        if (signResult === "manualFallback") {
          await waitForManualSignaturesComplete();
          await waitForManualSignatureSuccess();
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

      await waitForManualSignatureSuccess();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  })();
}
