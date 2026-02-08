import type { Metadata } from "next";
import { headers } from "next/headers";
import { Raleway } from "next/font/google";
import { ThemeProvider } from "next-themes";

import { Footer } from "@/components/footer";
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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = await headers().then((h) => h.get("x-nonce") ?? undefined);

  return (
    <html lang="en" className={raleway.variable} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
          <div className="flex-1">{children}</div>
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}
