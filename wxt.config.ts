import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "form-futo-fill",
    description: "自动填写",
    version: "0.0.1",
    permissions: ["activeTab", "scripting"],
    host_permissions: ["http://*:*/*", "https://*:*/*"],
    web_accessible_resources: [
      {
        resources: ["jquery.min.js"],
        matches: ["<all_urls>"],
      },
    ],
  },
});
