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
  title: "Admin - Web App Starter",
  description: "Administration panel for Web App Starter.",
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
