import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";

import "./globals.css";
import { ConvexClientProvider } from "@repo/auth/provider";
import { getToken } from "@repo/auth/server";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Admin - Launchpad Starter",
  description: "Administration panel for Launchpad Starter.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = await getToken();

  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${fraunces.variable}`}>
      <body>
        <ConvexClientProvider initialToken={token}>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
