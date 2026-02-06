import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";
import { TooltipProvider } from "@repo/ui";

import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

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
  title: "Design System — UI Components",
  description:
    "Interactive component showcase for the @repo/ui design system.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          <TooltipProvider>
            <div className="min-h-screen">
              <Sidebar />
              <main className="md:pl-[260px]">
                <div className="mx-auto max-w-4xl px-6 py-10 pt-16 md:pt-10">
                  {children}
                </div>
              </main>
            </div>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
