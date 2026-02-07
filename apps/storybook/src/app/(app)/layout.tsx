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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Resolve component page: /components/<slug>
  const componentSlug =
    pathname.startsWith("/components/") &&
    !pathname.startsWith("/components/category/")
      ? pathname.replace("/components/", "")
      : null;
  const entry = componentSlug
    ? componentRegistry.find((c) => c.slug === componentSlug)
    : null;

  // Resolve category page: /components/category/<slug>
  const categorySlugMatch = pathname.startsWith("/components/category/")
    ? pathname.replace("/components/category/", "")
    : null;
  const categoryName = categorySlugMatch
    ? slugToCategory(categorySlugMatch)
    : null;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                {entry ? (
                  <>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink asChild>
                        <Link
                          href={`/components/category/${categoryToSlug(entry.category)}`}
                        >
                          {entry.category}
                        </Link>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{entry.name}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                ) : categoryName ? (
                  <BreadcrumbItem>
                    <BreadcrumbPage>{categoryName}</BreadcrumbPage>
                  </BreadcrumbItem>
                ) : (
                  <BreadcrumbItem>
                    <BreadcrumbPage>Design System</BreadcrumbPage>
                  </BreadcrumbItem>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col p-6 pt-0">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
