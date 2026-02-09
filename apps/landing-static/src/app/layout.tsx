import "./globals.css";

/**
 * Root layout — delegates to [locale]/layout.tsx for the actual html/body shell.
 * This file exists because Next.js requires a root layout.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
