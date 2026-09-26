import type { Metadata } from "next";
import { headers } from "next/headers";
import { Raleway } from "next/font/google";
import { ThemeProvider } from "next-themes";

import "./globals.css";
import { ConvexClientProvider } from "@repo/auth/provider";
import {
  BrandTokenStyle,
  EnvironmentBannerWrapper,
  OfflineBanner,
  PublicConfigProvider,
} from "@repo/design-system";
import { readPublicConfigFromEnv } from "@repo/design-system/server";
import { getToken } from "@repo/auth/server";
import { ConvexErrorToast } from "@/components/convex-error-toast";
import { appConfig, tokenOverrideCss } from "@repo/app-config";

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: `Admin - ${appConfig.identity.productName}`,
  description: `Administration panel for ${appConfig.identity.productName}.`,
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [token, nonce] = await Promise.all([
    getToken(),
    headers().then((h) => h.get("x-nonce") ?? undefined),
  ]);

  // Read at request time, not build time, so one artifact can serve any
  // environment. See platform/docs/deployment-architecture.md
  const publicConfig = readPublicConfigFromEnv();

  return (
    <html lang="en" className={raleway.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
          {appConfig.features.environmentBanner && <EnvironmentBannerWrapper appName="admin" />}
          <BrandTokenStyle css={tokenOverrideCss(appConfig)} />
          <OfflineBanner />
          <PublicConfigProvider value={publicConfig}>
            <ConvexClientProvider initialToken={token} convexUrl={publicConfig.convexUrl}>
              <ConvexErrorToast />
              {children}
            </ConvexClientProvider>
          </PublicConfigProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
