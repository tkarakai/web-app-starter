"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function AvatarPage() {
  return (
    <ComponentPage
      title="Avatar"
      description="User profile images with fallback initials."
    >
      <DemoSection title="With Image">
        <div className="flex items-center gap-4">
          <Avatar>
            <AvatarImage
              src="https://api.dicebear.com/9.x/initials/svg?seed=JD"
              alt="John Doe"
            />
            <AvatarFallback>JD</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarImage
              src="https://api.dicebear.com/9.x/initials/svg?seed=AS"
              alt="Alice Smith"
            />
            <AvatarFallback>AS</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarImage
              src="https://api.dicebear.com/9.x/initials/svg?seed=BW"
              alt="Bob Wilson"
            />
            <AvatarFallback>BW</AvatarFallback>
          </Avatar>
        </div>
      </DemoSection>

      <DemoSection title="Fallback (No Image)">
        <div className="flex items-center gap-4">
          <Avatar>
            <AvatarFallback>JD</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>AS</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>BW</AvatarFallback>
          </Avatar>
        </div>
      </DemoSection>

      <DemoSection title="Sizes (via className)">
        <div className="flex items-center gap-4">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">SM</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>MD</AvatarFallback>
          </Avatar>
          <Avatar className="h-14 w-14">
            <AvatarFallback className="text-lg">LG</AvatarFallback>
          </Avatar>
          <Avatar className="h-20 w-20">
            <AvatarFallback className="text-xl">XL</AvatarFallback>
          </Avatar>
        </div>
      </DemoSection>

      <DemoSection title="Group">
        <div className="flex -space-x-3">
          {["JD", "AS", "BW", "CK", "EM"].map((initials) => (
            <Avatar
              key={initials}
              className="border-2 border-background"
            >
              <AvatarImage
                src={`https://api.dicebear.com/9.x/initials/svg?seed=${initials}`}
                alt={initials}
              />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          ))}
        </div>
      </DemoSection>
    </ComponentPage>
  );
}
