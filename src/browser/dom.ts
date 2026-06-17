// 统一定义可以作为查询范围的 DOM 类型。
export type QueryScope = Document | Element | JQuery<HTMLElement>;

// 等待指定时间，用于给页面动画和异步渲染留出短暂缓冲。
export async function wait(duration: number = 600): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

// 将页面文本里的空格、换行和中文按钮间隔统一去掉，便于兼容“受 理”和“受理”。
export function normalizeText(text?: string | null): string {
  return (text || "").replace(/\s+/g, "");
}

// 判断传入对象是否为 jQuery 包装对象，便于统一处理原生 DOM 和 jQuery DOM。
export function isJQueryObject(value: unknown): value is JQuery<HTMLElement> {
  return !!value && typeof value === "object" && "jquery" in value;
}

// 将原生 DOM、Document 或 jQuery 对象统一转换为可查询的根节点。
export function resolveQueryRoot(scope: QueryScope): Document | Element {
  return isJQueryObject(scope) ? scope[0] : scope;
}

// 读取元素可见文本，并做标准化处理。
export function getElementText(element: Element | JQuery<HTMLElement>): string {
  const target = isJQueryObject(element) ? element[0] : element;
  return normalizeText(target?.textContent || "");
}

// 判断元素是否真实可见，避免点到隐藏弹窗或旧 DOM。
export function isVisibleElement(element?: Element | null): element is HTMLElement {
  if (!element) return false;

  // 读取元素矩形和样式，过滤隐藏节点。
  const htmlElement = element as HTMLElement;
  const rect = htmlElement.getBoundingClientRect();
  const style = window.getComputedStyle(htmlElement);

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    rect.width > 0 &&
    rect.height > 0
  );
}

// 在超时时间内反复检查条件，用轮询兜底页面框架的异步渲染。
export async function waitUntil(
  description: string,
  predicate: () => boolean | Promise<boolean>,
  timeout: number = 20000,
  interval: number = 200
): Promise<void> {
  const startTime = Date.now();

  // 循环等待目标条件成立。
  while (Date.now() - startTime < timeout) {
    if (await predicate()) return;
    await wait(interval);
  }

  throw new Error(`等待超时：${description}`);
}

// 监听指定 DOM 区域的变化，直到目标条件成立。
export function observeUntil(
  description: string,
  predicate: () => boolean | Promise<boolean>,
  options: {
    root?: Node;
    timeout?: number;
    interval?: number;
  } = {}
): Promise<void> {
  const root = options.root || document.body;
  const timeout = options.timeout ?? 15000;
  const interval = options.interval ?? 300;

  return new Promise((resolve, reject) => {
    let finished = false;
    let checking = false;

    // 统一清理监听器、定时器和超时器。
    const cleanup = () => {
      finished = true;
      observer.disconnect();
      window.clearInterval(intervalTimer);
      window.clearTimeout(timeoutTimer);
    };

    // 每次 DOM 变化或轮询触发时，都检查一次目标条件。
    const check = async () => {
      if (finished || checking) return;

      checking = true;

      try {
        if (await predicate()) {
          cleanup();
          resolve();
        }
      } catch {
        // 条件检查中的短暂异常通常表示 DOM 还没有挂载完成，继续等待即可。
      } finally {
        checking = false;
      }
    };

    // 监听子节点、文本和属性变化，覆盖 Ant Design 动态挂载和内容替换。
    const observer = new MutationObserver(() => {
      void check();
    });

    observer.observe(root, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });

    // 增加一个低频轮询兜底，避免某些框架更新没有触发目标区域的 mutation。
    const intervalTimer = window.setInterval(() => {
      void check();
    }, interval);

    // 超时后主动失败，防止自动流程一直挂起。
    const timeoutTimer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`等待超时：${description}`));
    }, timeout);

    // 先立即检查一次，兼容进入函数前页面已经加载完成的情况。
    void check();
  });
}

// 让目标元素滚动到视口中部，保证下拉弹层能计算出可点击位置。
export function scrollElementToCenter(element: Element): void {
  element.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: "auto",
  });
}

// 触发输入框相关事件，保证 React/Vue 受控组件同步到内部状态。
export function dispatchInputEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
}

// 模拟键盘事件，供 Ant Design Select 搜索框触发候选项刷新使用。
export function simulateKeyEvent(
  element: HTMLElement,
  key: string,
  keyCode: number
): void {
  const eventOptions = {
    key,
    code: key === "Enter" ? "Enter" : `Key${key.toUpperCase()}`,
    keyCode,
    bubbles: true,
    cancelable: true,
    which: keyCode,
  };

  // 依次派发按下和抬起事件，模拟用户真实键盘操作。
  element.dispatchEvent(new KeyboardEvent("keydown", eventOptions));
  element.dispatchEvent(new KeyboardEvent("keyup", eventOptions));
}
