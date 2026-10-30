import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/postcss";
import { EXTENSION_PUBLIC_KEY, RELEASE_WEBSITE_ORIGIN } from "@palside/shared/extension";

function configuredOrigin(name: "WXT_API_URL" | "WXT_WEBSITE_URL", fallback: string) {
  const value = process.env[name] || fallback;
  const origin = new URL(value);
  if (process.env.PALSIDE_RELEASE_BUILD && (!process.env[name] || origin.protocol !== "https:")) throw new Error(`${name} must be an explicit HTTPS origin for release builds`);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error(`${name} must be an origin URL`);
  return origin;
}

// The API is reached through server CORS for the pinned extension origin, so no host permission is requested.
configuredOrigin("WXT_API_URL", "http://127.0.0.1:8787");
// External messages come only from the website; release builds accept nothing but the published site.
const websiteOrigin = configuredOrigin("WXT_WEBSITE_URL", "http://localhost:3000").origin;
if (process.env.PALSIDE_RELEASE_BUILD && websiteOrigin !== RELEASE_WEBSITE_ORIGIN) throw new Error(`WXT_WEBSITE_URL must be ${RELEASE_WEBSITE_ORIGIN} for release builds`);

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: false,
  manifestVersion: 3,
  manifest: {
    name: "__MSG_name__",
    // The store rejects a manifest key and assigns the published ID; local builds pin that same ID through its public key.
    ...(process.env.PALSIDE_RELEASE_BUILD ? {} : { key: EXTENSION_PUBLIC_KEY }),
    description: "__MSG_description__",
    default_locale: "en",
    minimum_chrome_version: "123",
    permissions: ["sidePanel", "storage", "offscreen", "idle", "scripting", "activeTab"],
    externally_connectable: { matches: [websiteOrigin + "/*"] },
    // tabs + favicon: 共享在看 (读取您的浏览记录, which covers the page icon), asked together on its first use.
    // Installing therefore shows no permission warning at all.
    optional_permissions: ["notifications", "tabs", "favicon"],
    optional_host_permissions: ["<all_urls>"],
    web_accessible_resources: [{ resources: ["signals/*"], matches: ["http://*/*", "https://*/*"] }],
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
    action: {
      default_title: "__MSG_open__",
      default_icon: { 16: "icon-16.png", 24: "icon-24.png", 32: "icon-32.png", 48: "icon-48.png" },
    },
    // 截图: Chrome gives the tab to Palside (activeTab) when its shortcut is pressed; a click inside the side panel does not.
    commands: { capture: { suggested_key: { default: "Alt+Shift+S" }, description: "__MSG_captureCommand__" } },
  },
  vite: () => ({
    define: { "import.meta.env.WXT_WEBSITE_URL": JSON.stringify(websiteOrigin) },
    css: { postcss: { plugins: [tailwindcss()] } },
  }),
});
