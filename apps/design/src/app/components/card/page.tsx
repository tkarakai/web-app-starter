"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function CardPage() {
  return (
    <ComponentPage
      title="Card"
      description="Container for grouped content with header, body, and footer sections."
    >
      <DemoSection title="Basic Card">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Card Title</CardTitle>
            <CardDescription>
              A short description of the card content.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              This is the card body. It can contain any content — text,
              images, forms, or other components.
            </p>
          </CardContent>
        </Card>
      </DemoSection>

      <DemoSection title="Card with Footer Actions">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Confirm Action</CardTitle>
            <CardDescription>
              Are you sure you want to proceed?
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This action cannot be undone. Please review before confirming.
            </p>
          </CardContent>
          <CardFooter className="gap-2">
            <Button variant="outline" size="sm">
              Cancel
            </Button>
            <Button size="sm">Confirm</Button>
          </CardFooter>
        </Card>
      </DemoSection>

      <DemoSection title="Card with Form">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Create Account</CardTitle>
            <CardDescription>
              Enter your details to get started.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="card-name">Name</Label>
              <Input id="card-name" placeholder="John Doe" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-email">Email</Label>
              <Input
                id="card-email"
                type="email"
                placeholder="john@example.com"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full">Create Account</Button>
          </CardFooter>
        </Card>
      </DemoSection>

      <DemoSection title="Card Grid">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { title: "Revenue", value: "$12,450", change: "+12%" },
            { title: "Users", value: "1,234", change: "+5%" },
            { title: "Orders", value: "342", change: "+18%" },
            { title: "Conversion", value: "3.2%", change: "-2%" },
          ].map((stat) => (
            <Card key={stat.title}>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">{stat.title}</p>
                <p className="mt-1 text-2xl font-bold">{stat.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stat.change} from last month
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </DemoSection>
    </ComponentPage>
  );
}
