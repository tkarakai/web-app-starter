import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Raleway } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

import { Toaster } from "@repo/design-system";
import { ConvexClientProvider } from "@repo/auth/provider";
import { getToken } from "@repo/auth/server";
import { getLocaleDirection, type Locale, locales } from "@repo/i18n";

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Web App Starter",
  description: "A Next.js starter with Convex, Better Auth, and Bun.",
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  const [token, nonce, messages] = await Promise.all([
    getToken(),
    headers().then((h) => h.get("x-nonce") ?? undefined),
    getMessages(),
  ]);

  const dir = getLocaleDirection(locale);

  return (
    <html lang={locale} dir={dir} className={raleway.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
          <NextIntlClientProvider messages={messages}>
            <ConvexClientProvider initialToken={token}>{children}</ConvexClientProvider>
            <Toaster richColors closeButton position="bottom-right" />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
