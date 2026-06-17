import $ from "jquery";
import {
  dispatchInputEvents,
  getElementText,
  isVisibleElement,
  normalizeText,
  QueryScope,
  resolveQueryRoot,
  scrollElementToCenter,
  simulateKeyEvent,
  wait,
} from "@/src/browser/dom";

// 根据文本查找当前可见的按钮，兼容 Ant Design 按钮中间出现空格。
export function findVisibleButton(
  buttonText: string,
  scope: QueryScope = document
): JQuery<HTMLElement> {
  const normalizedButtonText = normalizeText(buttonText);
  const root = resolveQueryRoot(scope);
  const buttons = Array.from(
    root.querySelectorAll<HTMLElement>("button, .ant-btn")
  ).filter((button) => {
    return (
      isVisibleElement(button) &&
      getElementText(button).includes(normalizedButtonText)
    );
  });

  // 如果没有找到目标按钮，直接抛出明确的中文错误。
  if (!buttons.length) {
    throw new Error(`没有找到按钮：${buttonText}`);
  }

  return $(buttons[0]);
}

// 点击指定文本的可见按钮，并给页面一个最短渲染缓冲。
export async function clickVisibleButton(
  buttonText: string,
  scope: QueryScope = document
): Promise<void> {
  findVisibleButton(buttonText, scope).trigger("click");
  await wait(300);
}

// 查找当前可见弹窗，用于避免误操作隐藏的历史弹窗节点。
export function findVisibleModal(): JQuery<HTMLElement> {
  const modal = Array.from(document.querySelectorAll<HTMLElement>(".ant-modal")).find(
    (element) => isVisibleElement(element)
  );

  // 如果没有可见弹窗，说明流程状态与预期不一致。
  if (!modal) {
    throw new Error("没有找到可见的弹窗");
  }

  return $(modal);
}

// 在指定区域中根据 label 文本查找 Ant Design 表单项。
export function findFormItem(
  labelText: string,
  scope?: QueryScope
): JQuery<HTMLElement> {
  const normalizedLabel = normalizeText(labelText);
  const $scope = scope ? $(resolveQueryRoot(scope)) : findVisibleModal();
  const formItem = $scope
    .find<HTMLElement>(".ant-form-item")
    .toArray()
    .find((item) => {
      const label = item.querySelector("label");
      return normalizeText(label?.textContent || "").includes(normalizedLabel);
    });

  // 如果没有找到表单项，说明页面结构变化或流程走错页面。
  if (!formItem) {
    throw new Error(`没有找到表单项：${labelText}`);
  }

  return $(formItem);
}

// 在指定区域中选择指定单选项。
export async function selectRadio(
  labelText: string,
  scope?: QueryScope
): Promise<void> {
  const normalizedLabel = normalizeText(labelText);
  const $scope = scope ? $(resolveQueryRoot(scope)) : findVisibleModal();
  const radio = $scope
    .find<HTMLElement>(".ant-radio-wrapper")
    .toArray()
    .find((item) => getElementText(item).includes(normalizedLabel));

  // 如果没有找到单选项，直接停止当前流程。
  if (!radio) {
    throw new Error(`没有找到单选项：${labelText}`);
  }

  $(radio).trigger("click");
  await wait(400);
}

// Fill a visible Ant Design form field by its label and notify the page framework.
export async function fillInputByLabel(
  labelText: string,
  value: string | number,
  options: {
    scope?: QueryScope;
    selector?: string;
  } = {}
): Promise<void> {
  const $formItem = findFormItem(labelText, options.scope);
  const input = $formItem.find<HTMLElement>(
    options.selector || "textarea, input:not([type='hidden'])"
  )[0];

  if (!input) {
    throw new Error(`没有找到表单项输入框：${labelText}`);
  }

  scrollElementToCenter(input);
  await wait(150);

  const valueText = String(value);
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (valueSetter) {
    valueSetter.call(input, valueText);
  } else {
    $(input).val(valueText);
  }

  dispatchInputEvents(input);
  await wait(200);
}

// 查找当前打开且可见的 Ant Design 下拉弹层。
function findVisibleDropdown(): JQuery<HTMLElement> {
  const dropdown = Array.from(
    document.querySelectorAll<HTMLElement>(".ant-select-dropdown")
  )
    .reverse()
    .find((element) => isVisibleElement(element));

  // 如果下拉面板不存在，说明点击控件没有成功展开。
  if (!dropdown) {
    throw new Error("没有找到可见的下拉选项面板");
  }

  return $(dropdown);
}

// 在当前下拉面板中点击指定文本的可见选项。
async function clickDropdownOption(optionText: string): Promise<boolean> {
  const normalizedOption = normalizeText(optionText);
  const $dropdown = findVisibleDropdown();
  const option = $dropdown
    .find<HTMLElement>(".ant-select-item-option, [role='option']")
    .toArray()
    .find((item) => {
      return (
        isVisibleElement(item) &&
        getElementText(item).includes(normalizedOption)
      );
    });

  // 未找到时返回 false，让上层继续尝试滚动或切分组。
  if (!option) return false;

  $(option).trigger("click");
  await wait(400);
  return true;
}

// 通过滚动虚拟列表，让目标选项有机会被 Ant Design 渲染到 DOM 中。
async function scrollDropdownToFindOption(optionText: string): Promise<boolean> {
  const $dropdown = findVisibleDropdown();
  const holder = $dropdown.find<HTMLElement>(".rc-virtual-list-holder")[0];

  // 如果不是虚拟列表，就不做滚动兜底。
  if (!holder) return false;

  // 分段滚动虚拟列表，逐段查找目标选项。
  for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
    holder.scrollTop = holder.scrollHeight * ratio;
    holder.dispatchEvent(new Event("scroll", { bubbles: true }));
    await wait(300);

    if (await clickDropdownOption(optionText)) {
      return true;
    }
  }

  return false;
}

// 在分组式下拉中先切换分组，再查找目标选项。
async function switchDropdownGroupAndFindOption(
  groupText: string,
  optionText: string
): Promise<boolean> {
  if (await clickDropdownOption(optionText)) return true;

  // 点击“02”等分组入口后，等待右侧候选项刷新。
  if (await clickDropdownOption(groupText)) {
    await wait(500);
    return (
      (await clickDropdownOption(optionText)) ||
      (await scrollDropdownToFindOption(optionText))
    );
  }

  return false;
}

// 根据表单 label 打开下拉框，并选择目标选项。
export async function selectDropdownByLabel(
  labelText: string,
  optionText: string,
  options: {
    skipWhenContains?: string;
    tryGroupText?: string;
    scope?: QueryScope;
  } = {}
): Promise<void> {
  const $formItem = findFormItem(labelText, options.scope);
  const currentText = getElementText($formItem);

  // 如果多选框已经带入目标内容，就不重复选择。
  if (
    options.skipWhenContains &&
    currentText.includes(normalizeText(options.skipWhenContains))
  ) {
    console.log(`表单项【${labelText}】已包含【${options.skipWhenContains}】，跳过选择`);
    return;
  }

  // 先滚动到中部，减少下拉面板不可点击的问题。
  scrollElementToCenter($formItem[0]);
  await wait(300);

  // 优先点击真实输入框，失败时再点击选择器外壳。
  const input = $formItem.find<HTMLElement>("input[role='combobox'], input").last()[0];
  const selector = $formItem.find<HTMLElement>(".ant-select-selector")[0];

  if (!input && !selector) {
    throw new Error(`表单项【${labelText}】没有找到可点击的下拉控件`);
  }

  // 点击控件打开下拉面板。
  $(input || selector).trigger("click");
  await wait(500);

  // 尝试通过键盘让下拉组件刷新可选项。
  if (input) {
    simulateKeyEvent(input, "ArrowDown", 40);
    dispatchInputEvents(input);
    await wait(300);
  }

  // 依次尝试直接点击、切换分组、滚动虚拟列表。
  const selected =
    (await clickDropdownOption(optionText)) ||
    (options.tryGroupText
      ? await switchDropdownGroupAndFindOption(options.tryGroupText, optionText)
      : false) ||
    (await scrollDropdownToFindOption(optionText));

  if (!selected) {
    throw new Error(`表单项【${labelText}】没有找到选项【${optionText}】`);
  }
}
