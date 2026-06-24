import { TriggerType } from "@/types";
import { workflowRegistry } from "@/src/automation/registry";
import { AutomationContext, RunnerState } from "@/src/automation/types";

// 创建统一流程运行器，负责防重复启动、错误处理和日志输出。
class WorkflowRunner {
  // 保存当前运行状态，避免用户重复点击导致多个流程并发执行。
  private state: RunnerState = {
    running: false,
  };

  // 根据触发类型启动对应流程。
  run(triggerType: TriggerType): void {
    // 如果已有流程运行，则直接忽略本次触发。
    if (this.state.running) {
      console.log("已有自动处理流程正在运行，本次触发已忽略");
      return;
    }

    // 根据注册表查找业务流程。
    const workflow = workflowRegistry[triggerType];
    if (!workflow) {
      console.log(`没有找到自动处理流程：${triggerType}，请重新构建并刷新插件`);
      return;
    }

    // 标记流程开始运行。
    this.state.running = true;

    // 构建流程上下文，隐藏运行器内部状态细节。
    const context: AutomationContext = {
      log: (message, data) => {
        if (data === undefined) {
          console.log(message);
          return;
        }

        console.log(message, data);
      },
      shouldContinue: () => this.state.running,
    };

    // 异步执行流程，并在结束或异常时统一释放运行状态。
    workflow
      .run(context)
      .catch((error) => {
        console.log(`自动处理流程【${workflow.name}】异常停止`, error);
      })
      .finally(() => {
        this.state.running = false;
      });
  }
}

// 导出全局单例，保证 content script 中只有一个运行器实例。
export const workflowRunner = new WorkflowRunner();
