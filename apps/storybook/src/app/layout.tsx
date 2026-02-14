import type { Metadata } from "next";
import { Raleway } from "next/font/google";
import { ThemeProvider } from "next-themes";

import "./globals.css";
import { EnvironmentBannerWrapper } from "@/components/environment-banner-wrapper";

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Component Storybook",
  description: "Interactive component showcase for the @repo/design-system design system.",
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
          <EnvironmentBannerWrapper />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
