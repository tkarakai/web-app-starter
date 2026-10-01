import DocumentShell from "@/components/document-shell";

export default function EntryLayout({ children }: { children: React.ReactNode }) {
  return <DocumentShell>{children}</DocumentShell>;
}
