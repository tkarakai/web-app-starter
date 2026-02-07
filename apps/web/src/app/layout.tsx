import type { Metadata } from "next";
import { Raleway } from "next/font/google";

import "./globals.css";
import { ConvexClientProvider } from "@repo/auth/provider";
import { getToken } from "@repo/auth/server";

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Launchpad Starter",
  description: "A Bun-first Next.js starter wired to Convex and Better Auth.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = await getToken();

  return (
    <html lang="en" className={raleway.variable}>
      <body>
        <ConvexClientProvider initialToken={token}>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
