interface ComponentPageProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function ComponentPage({
  title,
  description,
  children,
}: ComponentPageProps) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
