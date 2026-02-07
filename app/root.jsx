import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import { AppProvider } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { useEffect } from "react";

export function links() {
  return [{ rel: "stylesheet", href: polarisStyles }];
}

export const loader = async ({ request }) => {
  const { getAppVersionInfo } = await import("./utils/environment.server.js");

  let shopDomain = null;
  try {
    const { authenticate } = await import("./shopify.server");
    const auth = await authenticate.admin(request);
    if (auth?.session?.shop) {
      shopDomain = auth.session.shop;
    }
  } catch {
    shopDomain = null;
  }

  return {
    appVersions: getAppVersionInfo({ shopDomain }),
    helpscoutBeaconId: process.env.HELPSCOUT_BEACON_ID || null,
  };
};

export default function App() {
  const { appVersions, helpscoutBeaconId } = useLoaderData();

  useEffect(() => {
    if (typeof window !== "undefined" && appVersions) {
      const ns = (window["discounts-display-pro"] =
        window["discounts-display-pro"] || {});
      ns.versions = appVersions;
    }
  }, [appVersions]);

  useEffect(() => {
    if (typeof window === "undefined" || !helpscoutBeaconId) return;

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.innerHTML = `
      !function(e,t,n){function a(){var e=t.getElementsByTagName("script")[0],n=t.createElement("script");n.type="text/javascript",n.async=!0,n.src="https://beacon-v2.helpscout.net",e.parentNode.insertBefore(n,e)}if(e.Beacon=n=function(t,n,a){e.Beacon.readyQueue.push({method:t,options:n,data:a})},n.readyQueue=[],"complete"===t.readyState)return a();e.attachEvent?e.attachEvent("onload",a):e.addEventListener("load",a,!1)}(window,document,window.Beacon||function(){});
    `;
    document.head.appendChild(script);

    setTimeout(() => {
      if (window.Beacon) {
        window.Beacon("init", helpscoutBeaconId);
      }
    }, 1000);
  }, [helpscoutBeaconId]);

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
      </head>
      <body>
        <AppProvider i18n={{}}>
          <Outlet />
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
