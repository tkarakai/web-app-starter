"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Separator,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@repo/design-system";
import {
  categoryToSlug,
  componentRegistry,
  slugToCategory,
} from "@/lib/registry";
import {
  patternCategoryToSlug,
  patternRegistry,
  slugToPatternCategory,
} from "@/lib/pattern-registry";
import {
  foundationCategoryToSlug,
  foundationRegistry,
  slugToFoundationCategory,
} from "@/lib/foundation-registry";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Resolve component page: /components/<slug>
  const componentSlug =
    pathname.startsWith("/components/") &&
    !pathname.startsWith("/components/category/")
      ? pathname.replace("/components/", "")
      : null;
  const componentEntry = componentSlug
    ? componentRegistry.find((c) => c.slug === componentSlug)
    : null;

  // Resolve category page: /components/category/<slug>
  const categorySlugMatch = pathname.startsWith("/components/category/")
    ? pathname.replace("/components/category/", "")
    : null;
  const categoryName = categorySlugMatch
    ? slugToCategory(categorySlugMatch)
    : null;

  // Resolve pattern page: /patterns/<slug>
  const patternSlug =
    pathname.startsWith("/patterns/") &&
    !pathname.startsWith("/patterns/category/")
      ? pathname.replace("/patterns/", "")
      : null;
  const patternEntry = patternSlug
    ? patternRegistry.find((p) => p.slug === patternSlug)
    : null;

  // Resolve pattern category page: /patterns/category/<slug>
  const patternCategorySlugMatch = pathname.startsWith("/patterns/category/")
    ? pathname.replace("/patterns/category/", "")
    : null;
  const patternCategoryName = patternCategorySlugMatch
    ? slugToPatternCategory(patternCategorySlugMatch)
    : null;

  // Resolve foundation page: /foundations/<slug>
  const foundationSlug =
    pathname.startsWith("/foundations/") &&
    !pathname.startsWith("/foundations/category/")
      ? pathname.replace("/foundations/", "")
      : null;
  const foundationEntry = foundationSlug
    ? foundationRegistry.find((f) => f.slug === foundationSlug)
    : null;

  // Resolve foundation category page: /foundations/category/<slug>
  const foundationCategorySlugMatch = pathname.startsWith("/foundations/category/")
    ? pathname.replace("/foundations/category/", "")
    : null;
  const foundationCategoryName = foundationCategorySlugMatch
    ? slugToFoundationCategory(foundationCategorySlugMatch)
    : null;

  // Determine breadcrumb content
  const renderBreadcrumbs = () => {
    if (componentEntry) {
      return (
        <>
          <BreadcrumbItem className="hidden md:block">
            <BreadcrumbLink asChild>
              <Link href="/">Components</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem className="hidden md:block">
            <BreadcrumbLink asChild>
              <Link
                href={`/components/category/${categoryToSlug(componentEntry.category)}`}
              >
                {componentEntry.category}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{componentEntry.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </>
      );
    }

    if (categoryName) {
      return (
        <>
          <BreadcrumbItem className="hidden md:block">
            <BreadcrumbLink asChild>
              <Link href="/">Components</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{categoryName}</BreadcrumbPage>
          </BreadcrumbItem>
        </>
      );
    }

    if (patternEntry) {
      return (
        <>
          <BreadcrumbItem className="hidden md:block">
            <BreadcrumbLink asChild>
              <Link href="/">Patterns</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem className="hidden md:block">
            <BreadcrumbLink asChild>
              <Link
                href={`/patterns/category/${patternCategoryToSlug(patternEntry.category)}`}
              >
                {patternEntry.category}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{patternEntry.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </>
      );
    }

    if (patternCategoryName) {
      return (
        <>
          <BreadcrumbItem className="hidden md:block">
            <BreadcrumbLink asChild>
              <Link href="/">Patterns</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{patternCategoryName}</BreadcrumbPage>
          </BreadcrumbItem>
        </>
      );
    }

    if (foundationEntry) {
      return (
        <>
          <BreadcrumbItem className="hidden md:block">
            <BreadcrumbLink asChild>
              <Link href="/">Foundations</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem className="hidden md:block">
            <BreadcrumbLink asChild>
              <Link
                href={`/foundations/category/${foundationCategoryToSlug(foundationEntry.category)}`}
              >
                {foundationEntry.category}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{foundationEntry.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </>
      );
    }

    if (foundationCategoryName) {
      return (
        <>
          <BreadcrumbItem className="hidden md:block">
            <BreadcrumbLink asChild>
              <Link href="/">Foundations</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{foundationCategoryName}</BreadcrumbPage>
          </BreadcrumbItem>
        </>
      );
    }

    return (
      <BreadcrumbItem>
        <BreadcrumbPage>Components</BreadcrumbPage>
      </BreadcrumbItem>
    );
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="flex flex-col h-dvh min-w-0">
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border/40 bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                {renderBreadcrumbs()}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          <div className="mx-auto w-full max-w-[58rem]">
            {children}
          </div>
        </div>
        <footer className="sticky bottom-0 shrink-0 h-5 border-t border-border/40 bg-background" />
      </SidebarInset>
    </SidebarProvider>
  );
}
