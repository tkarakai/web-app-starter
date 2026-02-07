import type { Metadata } from "next";
import { Raleway } from "next/font/google";

import "./globals.css";

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Launchpad Starter",
  description: "A Bun-first Next.js starter wired to Convex and Better Auth.",
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
