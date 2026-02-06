"use client";

import * as React from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/ui";
import { ChevronDown } from "lucide-react";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function DropdownMenuPage() {
  const [showStatusBar, setShowStatusBar] = React.useState(true);
  const [showPanel, setShowPanel] = React.useState(false);
  const [sortBy, setSortBy] = React.useState("date");

  return (
    <ComponentPage
      title="Dropdown Menu"
      description="Contextual menu with actions, checkboxes, radio groups, and sub-menus."
    >
      <DemoSection title="Basic Menu">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              Open Menu <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuItem>Archive</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </DemoSection>

      <DemoSection title="With Shortcuts">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              File <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48">
            <DropdownMenuItem>
              New File
              <DropdownMenuShortcut>&#8984;N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              Open
              <DropdownMenuShortcut>&#8984;O</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              Save
              <DropdownMenuShortcut>&#8984;S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              Close
              <DropdownMenuShortcut>&#8984;W</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </DemoSection>

      <DemoSection title="Checkbox Items">
        <div className="flex items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                View <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Toggle Panels</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={showStatusBar}
                onCheckedChange={setShowStatusBar}
              >
                Status Bar
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={showPanel}
                onCheckedChange={setShowPanel}
              >
                Side Panel
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="text-sm text-muted-foreground">
            Status Bar: {showStatusBar ? "on" : "off"} · Side Panel:{" "}
            {showPanel ? "on" : "off"}
          </span>
        </div>
      </DemoSection>

      <DemoSection title="Radio Group">
        <div className="flex items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                Sort By <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Sort Order</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={sortBy}
                onValueChange={setSortBy}
              >
                <DropdownMenuRadioItem value="date">
                  Date
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="name">
                  Name
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="size">
                  Size
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="text-sm text-muted-foreground">
            Sorting by: {sortBy}
          </span>
        </div>
      </DemoSection>

      <DemoSection title="Sub Menu">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              Options <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Settings</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Share</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Email</DropdownMenuItem>
                <DropdownMenuItem>Slack</DropdownMenuItem>
                <DropdownMenuItem>Copy Link</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Log Out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </DemoSection>
    </ComponentPage>
  );
}
