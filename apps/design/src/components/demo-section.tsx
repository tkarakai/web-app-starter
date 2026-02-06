interface DemoSectionProps {
  title: string;
  children: React.ReactNode;
}

export function DemoSection({ title, children }: DemoSectionProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </h3>
      <div className="rounded-lg border border-border/60 bg-card/50 p-6">
        {children}
      </div>
    </div>
  );
}
