import { RequestAction, TriggerType } from "@/types";
import $ from "jquery";
import { workflowRunner } from "@/src/automation/runner";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_end",
  main() {
    // 暴露 jQuery，方便在页面控制台临时排查选择器。
    (window as any).$ = $;

    // 监听 popup 发来的自动处理指令，并交给统一运行器分发。
    browser.runtime.onMessage.addListener(
      (request: RequestAction<TriggerType>, _sender, sendResponse) => {
        // 只处理自动填表动作，其他消息保持静默。
        if (request.action !== "triggerAutoFill") {
          return;
        }

        // 启动对应流程；运行器内部会防止重复启动。
        workflowRunner.run(request.data);

        // 立即响应 popup，避免消息通道因为长流程而阻塞。
        sendResponse();
        return true;
      }
    );
  },
});
