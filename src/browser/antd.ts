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

type DropdownSelectMode = "single" | "multiple";
type DropdownOptionInput = string | string[];

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

// 将单个选项和多个选项统一整理成数组，方便后续按顺序处理。
function normalizeDropdownOptions(optionText: DropdownOptionInput): string[] {
  return Array.isArray(optionText) ? optionText : [optionText];
}

// 判断当前表单项是否已经包含指定的选项文本。
function formItemContainsOption(currentText: string, optionText: string): boolean {
  return currentText.includes(normalizeText(optionText));
}

// 根据选择模式判断是否可以跳过当前下拉选择。
function shouldSkipDropdownSelection(
  currentText: string,
  skipOptions: string[],
  selectMode: DropdownSelectMode
): boolean {
  // 如果没有配置跳过条件，就继续执行选择流程。
  if (!skipOptions.length) return false;

  // 单选模式只要命中任意一个候选值，就认为页面已有有效默认值。
  if (selectMode === "single") {
    return skipOptions.some((option) => formItemContainsOption(currentText, option));
  }

  // 多选模式需要全部候选值都已存在，才跳过后续补选。
  return skipOptions.every((option) => formItemContainsOption(currentText, option));
}

// 根据选择模式生成更清晰的跳过日志。
function getSkipMessage(
  labelText: string,
  skipOptions: string[],
  selectMode: DropdownSelectMode
): string {
  const joinedOptions = skipOptions.join("、");
  const modeText = selectMode === "single" ? "任意包含" : "全部包含";
  return `表单项【${labelText}】已${modeText}【${joinedOptions}】，跳过选择`;
}

// 打开指定表单项的下拉面板，并尽量触发 Ant Design 渲染候选项。
async function openDropdownFromFormItem(
  labelText: string,
  $formItem: JQuery<HTMLElement>
): Promise<void> {
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
}

// 按照已有的直接点击、分组切换和虚拟滚动策略尝试选择一个候选项。
async function trySelectDropdownOption(
  optionText: string,
  tryGroupText?: string
): Promise<boolean> {
  return (
    (await clickDropdownOption(optionText)) ||
    (tryGroupText
      ? await switchDropdownGroupAndFindOption(tryGroupText, optionText)
      : false) ||
    (await scrollDropdownToFindOption(optionText))
  );
}

// 根据表单 label 打开下拉框，并选择目标选项。
export async function selectDropdownByLabel(
  labelText: string,
  optionText: DropdownOptionInput,
  options: {
    skipWhenContains?: DropdownOptionInput;
    selectMode?: DropdownSelectMode;
    tryGroupText?: string;
    scope?: QueryScope;
  } = {}
): Promise<void> {
  const $formItem = findFormItem(labelText, options.scope);
  const currentText = getElementText($formItem);
  const optionTexts = normalizeDropdownOptions(optionText);
  const skipOptions = options.skipWhenContains
    ? normalizeDropdownOptions(options.skipWhenContains)
    : [];
  const selectMode = options.selectMode || "single";

  // 如果表单项已经带入目标内容，就不重复选择。
  if (shouldSkipDropdownSelection(currentText, skipOptions, selectMode)) {
    console.log(getSkipMessage(labelText, skipOptions, selectMode));
    return;
  }

  // 先打开下拉框，后续选择逻辑复用同一个可见弹层。
  await openDropdownFromFormItem(labelText, $formItem);

  // 单选模式按配置顺序匹配第一个可用候选项。
  if (selectMode === "single") {
    for (const candidate of optionTexts) {
      if (await trySelectDropdownOption(candidate, options.tryGroupText)) {
        return;
      }
    }

    throw new Error(`表单项【${labelText}】没有找到任一选项【${optionTexts.join("、")}】`);
  }

  // 多选模式只补选当前表单项中尚未包含的候选项。
  let selectedCount = 0;
  for (const candidate of optionTexts) {
    if (formItemContainsOption(currentText, candidate)) {
      continue;
    }

    // 多选下拉通常不会关闭；如果页面组件主动关闭，则重新打开后再尝试当前候选项。
    let selected = false;
    try {
      selected = await trySelectDropdownOption(candidate, options.tryGroupText);
    } catch {
      await openDropdownFromFormItem(labelText, $formItem);
      selected = await trySelectDropdownOption(candidate, options.tryGroupText);
    }

    // 记录本轮实际补选成功的数量，后续用于判断配置是否完全无效。
    if (selected) {
      selectedCount += 1;
    }
  }

  // 多选模式至少需要成功补选一个选项，避免静默吞掉配置错误。
  if (!selectedCount) {
    throw new Error(`表单项【${labelText}】没有找到可选择的选项【${optionTexts.join("、")}】`);
  }
}
