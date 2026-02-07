import type { Metadata } from "next";
import { Raleway } from "next/font/google";

import "./globals.css";

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Component Storybook",
  description: "Interactive component showcase for the @repo/ui design system.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={raleway.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
