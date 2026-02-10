import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        {children}
      </body>
    </html>
  );
}
