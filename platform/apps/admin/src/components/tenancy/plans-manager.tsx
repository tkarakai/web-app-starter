"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@repo/backend";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web-app-starter/design-system";
import { parseDollars } from "@/lib/tenancy";

type Plan = {
  id: string;
  name: string;
  priceMonthlyUsdCents: number;
  isFreeForever: boolean;
  isSeeded: boolean;
  isDefault: boolean;
  status: "active" | "inactive" | "archived";
  inUse: boolean;
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : "Failed");

/**
 * The plan catalog: create plans, rename or reprice unused ones, change status and the default.
 * The seeded free-forever plan only changes status; a plan in use keeps its price.
 */
export function PlansManager() {
  const plans = useQuery(api.platform.billing.listPlans) as Plan[] | undefined;
  const ensureSeeded = useMutation(api.platform.billing.ensureSeeded);
  const updatePlan = useMutation(api.platform.billing.updatePlan);
  const setDefault = useMutation(api.platform.billing.setDefaultPlan);
  const [editing, setEditing] = React.useState<Plan | null>(null);
  const seeded = React.useRef(false);

  React.useEffect(() => {
    if (plans && plans.length === 0 && !seeded.current) {
      seeded.current = true;
      void ensureSeeded({}).catch(() => undefined);
    }
  }, [plans, ensureSeeded]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(message(error));
    }
  };

  return (
    <div className="space-y-6">
      <CreatePlanCard />
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Plans</CardTitle>
          <CardDescription>Active plans can be chosen. Inactive plans keep their organizations but can&apos;t be chosen; archived ones are also hidden from users. Plans are never deleted.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table data-testid="plans-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Price per month</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(plans ?? []).map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{plan.name}</span>
                      {plan.isDefault && <Badge>Default</Badge>}
                      {plan.isFreeForever && <Badge variant="secondary">Free forever</Badge>}
                      {plan.isSeeded && <Badge variant="outline">Seeded</Badge>}
                      {plan.inUse && <Badge variant="outline">In use</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>{usd.format(plan.priceMonthlyUsdCents / 100)}</TableCell>
                  <TableCell>
                    <Select
                      value={plan.status}
                      onValueChange={(status) => void run(() => updatePlan({ planId: plan.id, status: status as Plan["status"] }), `${plan.name} is ${status}.`)}
                      disabled={plan.isDefault}
                    >
                      <SelectTrigger className="w-32" aria-label={`Status of ${plan.name}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {!plan.isDefault && plan.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => void run(() => setDefault({ planId: plan.id }), `${plan.name} is the default plan.`)}>Make default</Button>
                    )}
                    {!plan.isSeeded && <Button size="sm" variant="outline" onClick={() => setEditing(plan)}>Edit</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {editing && <EditPlanDialog plan={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CreatePlanCard() {
  const createPlan = useMutation(api.platform.billing.createPlan);
  const [name, setName] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [freeForever, setFreeForever] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cents = freeForever ? 0 : parseDollars(price);
    if (!name.trim() || cents === null) return void toast.error("Enter a name and a price in US dollars, such as 19.00.");
    setBusy(true);
    try {
      await createPlan({ name: name.trim(), priceMonthlyUsdCents: cents, isFreeForever: freeForever });
      toast.success(`${name.trim()} created.`);
      setName(""); setPrice(""); setFreeForever(false);
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">New plan</CardTitle>
        <CardDescription>USD only. $0 is allowed; a plan that isn&apos;t free forever always needs a payer, even at $0, so its price can rise later. Free forever can&apos;t change after creation.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-[1fr_10rem_auto_auto] sm:items-end" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="plan-name">Plan name</Label>
            <Input id="plan-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="plan-price">Price per month (USD)</Label>
            <Input id="plan-price" inputMode="decimal" placeholder="19.00" value={freeForever ? "0" : price} disabled={freeForever} onChange={(event) => setPrice(event.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={freeForever} onCheckedChange={(checked) => setFreeForever(checked === true)} aria-label="Free forever" />
            Free forever
          </label>
          <Button type="submit" disabled={busy}>Create plan</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EditPlanDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const updatePlan = useMutation(api.platform.billing.updatePlan);
  const [name, setName] = React.useState(plan.name);
  const [price, setPrice] = React.useState((plan.priceMonthlyUsdCents / 100).toFixed(2));
  const priceLocked = plan.inUse || plan.isFreeForever;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cents = priceLocked ? undefined : parseDollars(price);
    if (cents === null) return void toast.error("Enter a price in US dollars, such as 19.00.");
    try {
      await updatePlan({ planId: plan.id, name: name.trim(), ...(cents !== undefined ? { priceMonthlyUsdCents: cents } : {}) });
      toast.success("Plan saved.");
      onClose();
    } catch (error) {
      toast.error(message(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {plan.name}</DialogTitle>
          <DialogDescription>{priceLocked ? "The price is fixed: the plan is in use or free forever. Create a new plan for a new price." : "The price can change until an organization uses the plan."}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="edit-plan-name">Plan name</Label>
            <Input id="edit-plan-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-plan-price">Price per month (USD)</Label>
            <Input id="edit-plan-price" inputMode="decimal" value={price} disabled={priceLocked} onChange={(event) => setPrice(event.target.value)} />
          </div>
          <Button type="submit">Save</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
