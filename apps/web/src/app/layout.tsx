import type { Metadata } from "next";
import { headers } from "next/headers";
import { Raleway } from "next/font/google";
import { ThemeProvider } from "next-themes";

import "./globals.css";
import { Toaster } from "@repo/design-system";
import { ConvexClientProvider } from "@repo/auth/provider";
import { getToken } from "@repo/auth/server";

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Web App Starter",
  description: "A Next.js starter with Convex, Better Auth, and Bun.",
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

  return (
    <html lang="en" className={raleway.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
          <ConvexClientProvider initialToken={token}>{children}</ConvexClientProvider>
          <Toaster richColors closeButton position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
