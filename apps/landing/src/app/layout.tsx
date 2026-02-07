import type { Metadata } from "next";
import { Raleway } from "next/font/google";

import "./globals.css";

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Web App Starter",
  description: "A Next.js starter with Convex, Better Auth, and Bun.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={raleway.variable}>
      <body>{children}</body>
    </html>
  );
}
