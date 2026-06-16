// 定义页面提示的类型，方便后续扩展不同颜色。
type NoticeType = "success" | "error" | "info";

// 统一维护自动化提示容器的 DOM id，避免重复创建多个容器。
const NOTICE_CONTAINER_ID = "form-auto-fill-notice-container";

// 创建或获取页面右上角提示容器。
function getNoticeContainer(): HTMLElement {
  const existedContainer = document.querySelector<HTMLElement>(
    `#${NOTICE_CONTAINER_ID}`
  );

  // 如果容器已经存在，直接复用。
  if (existedContainer) {
    return existedContainer;
  }

  // 创建提示容器，并固定在页面右上角。
  const container = document.createElement("div");
  container.id = NOTICE_CONTAINER_ID;
  container.style.position = "fixed";
  container.style.top = "88px";
  container.style.right = "24px";
  container.style.zIndex = "999999";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "10px";
  container.style.pointerEvents = "none";

  document.body.appendChild(container);
  return container;
}

// 根据提示类型获取左侧强调色。
function getNoticeColor(type: NoticeType): string {
  if (type === "success") return "#16a34a";
  if (type === "error") return "#dc2626";
  return "#2563eb";
}

// 在页面上显示一条自动消失的提示。
export function showNotice(
  message: string,
  type: NoticeType = "info",
  duration: number = 3000
): void {
  const container = getNoticeContainer();
  const notice = document.createElement("div");

  // 设置提示卡片样式，避免依赖站点自己的组件库。
  notice.textContent = message;
  notice.style.minWidth = "260px";
  notice.style.maxWidth = "420px";
  notice.style.padding = "12px 14px";
  notice.style.borderRadius = "8px";
  notice.style.border = "1px solid #d9d9d9";
  notice.style.borderLeft = `5px solid ${getNoticeColor(type)}`;
  notice.style.background = "#ffffff";
  notice.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.16)";
  notice.style.color = "#1f2937";
  notice.style.fontSize = "14px";
  notice.style.lineHeight = "1.5";
  notice.style.pointerEvents = "auto";

  container.appendChild(notice);

  // 到时间后移除提示，保持页面干净。
  window.setTimeout(() => {
    notice.remove();

    // 如果容器里已经没有提示，也一起移除容器。
    if (!container.children.length) {
      container.remove();
    }
  }, duration);
}
