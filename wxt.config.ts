import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "form-futo-fill",
    description: "自动填写",
    version: "0.0.1",
    permissions: ["activeTab", "tabs", "debugger", "scripting"],
    host_permissions: ["http://*:*/*", "https://*:*/*"],
    web_accessible_resources: [
      {
        resources: ["jquery.min.js", "opentype.min.js", "signature-fonts/*"],
        matches: ["<all_urls>"],
      },
    ],
  },
});
