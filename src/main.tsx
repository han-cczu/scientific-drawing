import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

/*
 * ========================================================================
 * 步骤1：挂载 React 应用
 * ========================================================================
 * 目标：
 *   1) 找到页面根节点
 *   2) 渲染 Scientific Drawing 工作台
 */
const root = document.getElementById("root");

// 1.1 校验根节点
if (!root) {
  throw new Error("Root element not found.");
}

// 1.2 渲染应用
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
