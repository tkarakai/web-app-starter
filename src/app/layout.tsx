import type { Metadata } from "next";

import "./globals.css";
import { Providers } from "@/app/providers";

export const metadata: Metadata = {
  title: "Web App Starter",
  description: "Next.js + Bun + Convex + BetterAuth starter"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {/* Providers are documented here to make global dependencies obvious. */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
