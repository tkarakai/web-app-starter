import { Skeleton } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function SkeletonPage() {
  return (
    <ComponentPage
      title="Skeleton"
      description="A placeholder loading animation to indicate content is being loaded."
    >
      <DemoSection title="Basic Shapes">
        <div className="space-y-4">
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
          <Skeleton className="h-4 w-[150px]" />
        </div>
      </DemoSection>

      <DemoSection title="Circular Skeleton">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-16 w-16 rounded-full" />
        </div>
      </DemoSection>

      <DemoSection
        title="Card Loading State"
        description="Compose skeletons to represent a card being loaded."
      >
        <div className="flex items-start gap-4 rounded-lg border border-border p-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-4 w-[180px]" />
            <Skeleton className="h-3 w-[250px]" />
            <Skeleton className="h-3 w-[200px]" />
          </div>
        </div>
      </DemoSection>

      <DemoSection
        title="Text Block Loading"
        description="Simulate a paragraph of text being loaded."
      >
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </DemoSection>

      <DemoSection
        title="List Loading"
        description="Skeleton pattern for a list of items with avatars."
      >
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-[160px]" />
                <Skeleton className="h-3 w-[220px]" />
              </div>
              <Skeleton className="h-8 w-[60px] rounded-md" />
            </div>
          ))}
        </div>
      </DemoSection>
    </ComponentPage>
  );
}
