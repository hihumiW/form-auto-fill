import reactLogo from "@/assets/react.svg";
import wxtLogo from "/wxt.svg";
import "./App.css";
import { TriggerType } from "@/types";

const getActiveTab = async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw Error("no active tab");
  }
  return tab;
};

const triggerAutoFill = async (type: TriggerType) => {
  const activeTab = await getActiveTab();
  browser.tabs.sendMessage(activeTab.id!, {
    action: "triggerAutoFill",
    data: type,
  });
};

function App() {
  const handleFormFill = (type: TriggerType) => {
    triggerAutoFill(type);
  };

  return (
    <>
      <div>
        <a href="https://wxt.dev" target="_blank">
          <img src={wxtLogo} className="logo" alt="WXT logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>表单自动化</h1>
      <div className="card">
        <button onClick={() => handleFormFill("applyForm")}>
          当事人申请
        </button>
        <button onClick={() => handleFormFill("oralCase")}>
          口头案件办理
        </button>
        <button onClick={() => handleFormFill("oralArchive")}>
          归档口头案件
        </button>
        <button onClick={() => handleFormFill("oralAudit")}>
          审核口头案件
        </button>
      </div>
      <p className="read-the-docs">要停止，直接刷新页面即可</p>
    </>
  );
}

export default App;
