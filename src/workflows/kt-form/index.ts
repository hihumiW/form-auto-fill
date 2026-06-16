import $ from "jquery";
import { Workflow } from "@/src/automation/types";
import {
  clickVisibleButton,
  selectDropdownByLabel,
  selectRadio,
} from "@/src/browser/antd";
import { dispatchInputEvents, getElementText, wait, waitUntil } from "@/src/browser/dom";

// 按输入框 id 写入文本，并触发表单框架同步。
async function triggerInput(inputId: string, value: string | number): Promise<void> {
  const input = document.querySelector<HTMLElement>(`#${inputId}`);

  // 如果输入框不存在，说明页面结构已经变化。
  if (!input) {
    throw new Error(`没有找到输入框：${inputId}`);
  }

  // 写入值并通知页面框架同步内部状态。
  $(input).val(value);
  await wait(100);
  dispatchInputEvents(input);
  await wait(100);
}

// 定义口头案件办理填表流程。
export const ktFormWorkflow: Workflow = {
  name: "口头案件办理填表",

  async run() {
    // 第一步切换到口头协议登记表。
    $('span.item-label:contains("口头协议登记表")').trigger("click");
    await wait();

    // 第二步选择调解结果。
    await selectDropdownByLabel("调解结果", "调解成功", { scope: document });

    // 第三步等待附件字段加载完成。
    await waitUntil("附件字段加载完成", () => {
      const formBox = document.querySelector(".form-box");
      return !!formBox && getElementText(formBox).includes("附件");
    });

    // 第四步填写基础字段。
    await triggerInput("form_item_tjdd", "调解室");

    // 第五步滚动到金额和协议内容区域。
    const container = document.querySelector<HTMLElement>(
      ".case-acceptance-register-container"
    );
    if (container) container.scrollTop = 999;

    // 第六步填写涉案金额和协议内容。
    await triggerInput("form_item_saje", "0");
    await triggerInput("form_item_xynr", "经双方协商后，达成一致，纠纷化解");

    // 第七步选择履行状态并保存。
    await selectRadio("协议已履行", document);
    await clickVisibleButton("保存");
  },
};
