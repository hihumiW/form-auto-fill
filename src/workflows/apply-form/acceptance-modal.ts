import {
  clickVisibleButton,
  findFormItem,
  findVisibleModal,
  selectDropdownByLabel,
  selectRadio,
} from "@/src/browser/antd";
import { getElementText, isVisibleElement, wait, waitUntil } from "@/src/browser/dom";
import { APPLY_FORM_CONFIG } from "@/src/workflows/apply-form/config";

// 填写案件受理弹窗中的必要字段。
export async function fillAcceptanceModal(): Promise<void> {
  // 第一步选择“受理为口头案件”，触发下方登记书表单加载。
  await selectRadio("受理为口头案件");

  // 第二步等待动态表单字段渲染完成。
  await waitUntil("案件受理登记书表单加载完成", () => {
    try {
      const modalText = getElementText(findVisibleModal());
      return (
        modalText.includes("案件受理登记书") &&
        modalText.includes("纠纷类别") &&
        modalText.includes("调解员")
      );
    } catch {
      return false;
    }
  });

  // 第三步选择纠纷类别，兼容新版下拉中的“02”分组。
  await selectDropdownByLabel("纠纷类别", APPLY_FORM_CONFIG.disputeType, {
    tryGroupText: "02",
  });

  // 第四步确认调解员；单选模式下如果系统已带入任一候选调解员，则直接跳过。
  await selectDropdownByLabel("调解员", APPLY_FORM_CONFIG.mediator, {
    skipWhenContains: APPLY_FORM_CONFIG.mediator,
    selectMode: APPLY_FORM_CONFIG.mediatorSelectMode,
  });

  // 第五步只校验系统自动带入的必填文本，不覆盖页面已有内容。
  if (!findFormItem("纠纷简要情况").find("textarea").val()) {
    throw new Error("纠纷简要情况为空，请检查页面自动带入数据");
  }

  // 第六步确认申请事项存在。
  if (!findFormItem("当事人申请事项").find("textarea").val()) {
    throw new Error("当事人申请事项为空，请检查页面自动带入数据");
  }
}

// 保存弹窗，并确认页面状态已经变成已受理。
export async function saveAcceptanceModal(): Promise<void> {
  const $modal = findVisibleModal();

  // 点击弹窗中的“保 存”按钮，不点击“保存并继续编辑”。
  await clickVisibleButton("保存", $modal);

  // 等待弹窗关闭。
  await waitUntil("案件受理弹窗关闭", () => {
    return !Array.from(document.querySelectorAll(".ant-modal")).some((modal) =>
      isVisibleElement(modal)
    );
  });

  // 等待详情页状态或提示更新为成功。
  await waitUntil("案件状态更新为已受理", () => {
    const pageText = getElementText(document.body);
    return pageText.includes("已受理") || pageText.includes("保存成功");
  });

  // 政务系统保存后立刻进入下一步容易出现 504，这里固定冷却一下。
  await wait(APPLY_FORM_CONFIG.saveSleepTime);
}
