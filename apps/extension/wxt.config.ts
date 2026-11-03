import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/postcss";
import { EXTENSION_PUBLIC_KEY, RELEASE_WEBSITE_ORIGIN } from "@palside/shared/extension";
import { extensionPagePolicy } from "@palside/shared/extension-policy";

if (process.env.PALSIDE_RELEASE_BUILD !== undefined && process.env.PALSIDE_RELEASE_BUILD !== "true") throw new Error('PALSIDE_RELEASE_BUILD must be true or unset');
const releaseBuild = process.env.PALSIDE_RELEASE_BUILD === "true";

function configuredOrigin(name: "WXT_API_URL" | "WXT_WEBSITE_URL", fallback: string) {
  const value = process.env[name] || fallback;
  const origin = new URL(value);
  if (releaseBuild && (!process.env[name] || origin.protocol !== "https:")) throw new Error(`${name} must be an explicit HTTPS origin for release builds`);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error(`${name} must be an origin URL`);
  return origin;
}

// The API is reached through server CORS for the pinned extension origin, so no host permission is requested.
const apiOrigin = configuredOrigin("WXT_API_URL", "http://127.0.0.1:8787").origin;
// External messages come only from the website; release builds accept nothing but the published site.
const websiteOrigin = configuredOrigin("WXT_WEBSITE_URL", "http://localhost:3000").origin;
if (releaseBuild && websiteOrigin !== RELEASE_WEBSITE_ORIGIN) throw new Error(`WXT_WEBSITE_URL must be ${RELEASE_WEBSITE_ORIGIN} for release builds`);

/** The shared dictionaries also hold the website's copy; the extension bundles only its own and the common namespace. */
function extensionMessages() {
  const dictionary = /[\\/]packages[\\/]i18n[\\/]src[\\/](?:en|zh-CN)\.json$/;
  return {
    name: "palside:extension-messages",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!dictionary.test(id)) return;
      const { common, extension } = JSON.parse(code);
      return { code: JSON.stringify({ common, extension }), map: null };
    },
  };
}

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: false,
  manifestVersion: 3,
  manifest: {
    name: "__MSG_name__",
    // The store rejects a manifest key and assigns the published ID; local builds pin that same ID through its public key.
    ...(releaseBuild ? {} : { key: EXTENSION_PUBLIC_KEY }),
    description: "__MSG_description__",
    default_locale: "en",
    minimum_chrome_version: "130",
    permissions: ["sidePanel", "storage", "offscreen", "idle", "scripting", "activeTab"],
    externally_connectable: { matches: [websiteOrigin + "/*"] },
    // tabs + favicon: 共享在看 (读取您的浏览记录, which covers the page icon), asked together on its first use.
    // Installing therefore shows no permission warning at all.
    optional_permissions: ["notifications", "tabs", "favicon"],
    optional_host_permissions: ["<all_urls>"],
    // Page layers load signal art by a per-session URL (use_dynamic_url; getURL returns it from Chrome 130), so sites cannot probe for Palside.
    web_accessible_resources: [{ resources: ["signals/*"], matches: ["http://*/*", "https://*/*"], use_dynamic_url: true }],
    // Extension pages reach only the API and bundled files; WXT adds its own dev-server allowances while serving.
    content_security_policy: { extension_pages: extensionPagePolicy(apiOrigin) },
    action: {
      default_title: "__MSG_open__",
      default_icon: { 16: "icon-16.png", 24: "icon-24.png", 32: "icon-32.png", 48: "icon-48.png" },
    },
    // 截图: Chrome gives the tab to Palside (activeTab) when its shortcut is pressed; a click inside the side panel does not.
    commands: { capture: { suggested_key: { default: "Alt+Shift+S" }, description: "__MSG_captureCommand__" } },
  },
  hooks: {
    // While serving, WXT reloads pages over its dev server; let them connect to it. Builds keep the policy as declared.
    "build:manifestGenerated": (wxt, manifest) => {
      const policy = manifest.content_security_policy;
      if (wxt.config.command !== "serve" || typeof policy !== "object" || !policy.extension_pages) return;
      policy.extension_pages = policy.extension_pages.replace(/connect-src ([^;]*)/, "connect-src $1 http://localhost:* ws://localhost:*");
    },
  },
  vite: () => ({
    define: { "import.meta.env.WXT_WEBSITE_URL": JSON.stringify(websiteOrigin) },
    css: { postcss: { plugins: [tailwindcss()] } },
    plugins: [extensionMessages()],
  }),
});
