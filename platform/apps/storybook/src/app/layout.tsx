import type { Metadata } from "next";
import { Raleway } from "next/font/google";
import { ThemeProvider } from "next-themes";

import "./globals.css";
import { BrandTokenStyle, EnvironmentBannerWrapper } from "@web-app-starter/design-system";
import { appConfig, tokenOverrideCss } from "@web-app-starter/app-config";

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Component Storybook",
  description: "Interactive component showcase for the @web-app-starter/design-system design system.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={raleway.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {appConfig.features.environmentBanner && <EnvironmentBannerWrapper appName="storybook" />}
          <BrandTokenStyle css={tokenOverrideCss(appConfig)} />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
