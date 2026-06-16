// 定义所有自动化流程需要遵守的统一接口。
export interface Workflow {
  // 流程名称用于日志输出和错误定位。
  name: string;

  // 执行流程主体；流程内部决定是单次执行还是循环执行。
  run(context: AutomationContext): Promise<void>;
}

// 定义流程执行期间可以使用的上下文能力。
export interface AutomationContext {
  // 输出中文日志，后续可替换成 popup 状态回传。
  log(message: string, data?: unknown): void;

  // 判断当前流程是否仍然允许继续运行。
  shouldContinue(): boolean;
}

// 定义运行器内部的运行状态。
export interface RunnerState {
  // 标记是否已有流程正在运行。
  running: boolean;
}
