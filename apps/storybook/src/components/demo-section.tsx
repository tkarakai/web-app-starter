interface DemoSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function DemoSection({
  title,
  description,
  children,
}: DemoSectionProps) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="rounded-lg border border-border/60 bg-card/50 p-6">
        {children}
      </div>
    </div>
  );
}
