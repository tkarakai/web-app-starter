import { notFound, redirect } from "next/navigation";
import { locales, type Locale } from "@web-app-starter/i18n";

export default async function WebHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) notFound();
  redirect(`/${locale}/dashboard`);
}
