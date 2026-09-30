import { defaultLocale } from "@web-app-starter/i18n";
import { loadMessages } from "@web-app-starter/i18n/messages";
import NotFoundContent from "@/components/not-found-content";

export default async function NotFound() {
  const { common } = await loadMessages(defaultLocale);
  if (typeof common !== "object" || typeof common.notFound !== "string") {
    throw new Error(`Missing common.notFound message for ${defaultLocale}`);
  }
  return <NotFoundContent initialText={common.notFound} />;
}
