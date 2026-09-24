import type { Metadata } from "next";
import { business } from "@/business/dispatch";

import "./globals.css";

export const metadata: Metadata = {
  title: business.name,
  description: business.description,
  icons: {
    icon: [{ url: "/northstar.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
