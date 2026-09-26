"use client";

import { useEffect, useState } from "react";
import { defaultLocale, getLocaleDirection, locales, type Locale } from "@web-app-starter/i18n";
import english from "@web-app-starter/i18n/messages/en.json";
import { loadMessages } from "@web-app-starter/i18n/messages";

export default function NotFound() {
  const [message, setMessage] = useState({ locale: defaultLocale, text: english.common.notFound });

  // A static host serves the same 404.html for every locale. Resolve the URL's
  // locale after hydration; the exported HTML uses the default-language message.
  useEffect(() => {
    const segment = window.location.pathname.split("/")[1];
    const locale = locales.includes(segment as Locale) ? segment as Locale : defaultLocale;
    let active = true;
    void loadMessages(locale).then((messages) => {
      const common = messages.common;
      const text = typeof common === "object" ? common.notFound : undefined;
      if (active && typeof text === "string") setMessage({ locale, text });
    }).catch(() => {
      // Keep the default-language message if the locale chunk is unavailable.
    });
    return () => { active = false; };
  }, []);

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            body { color: #000; background: #fff; margin: 0 }
            .nf-divider { border-right: 1px solid rgba(0,0,0,.3) }
            @media (prefers-color-scheme: dark) {
              body { color: #fff; background: #000 }
              .nf-divider { border-right-color: rgba(255,255,255,.3) }
            }
          `,
        }}
      />
      <div
        lang={message.locale}
        dir={getLocaleDirection(message.locale)}
        style={{
          fontFamily:
            'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          height: "100vh",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div>
          <h1
            className="nf-divider"
            style={{
              display: "inline-block",
              margin: "0 20px 0 0",
              padding: "0 23px 0 0",
              fontSize: 24,
              fontWeight: 500,
              verticalAlign: "top",
              lineHeight: "49px",
            }}
          >
            404
          </h1>
          <div style={{ display: "inline-block" }}>
            <h2
              style={{
                fontSize: 14,
                fontWeight: 400,
                lineHeight: "49px",
                margin: 0,
              }}
            >
              {message.text}
            </h2>
          </div>
        </div>
      </div>
    </>
  );
}
