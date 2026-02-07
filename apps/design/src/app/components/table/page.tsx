import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

const invoices = [
  {
    invoice: "INV-001",
    status: "Paid",
    method: "Credit Card",
    amount: "$250.00",
  },
  {
    invoice: "INV-002",
    status: "Pending",
    method: "PayPal",
    amount: "$150.00",
  },
  {
    invoice: "INV-003",
    status: "Unpaid",
    method: "Bank Transfer",
    amount: "$350.00",
  },
  {
    invoice: "INV-004",
    status: "Paid",
    method: "Credit Card",
    amount: "$450.00",
  },
  {
    invoice: "INV-005",
    status: "Paid",
    method: "PayPal",
    amount: "$550.00",
  },
  {
    invoice: "INV-006",
    status: "Pending",
    method: "Bank Transfer",
    amount: "$200.00",
  },
];

export default function TablePage() {
  return (
    <ComponentPage
      title="Table"
      description="Display tabular data with headers, rows, and cells."
    >
      <DemoSection title="Basic Table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">Invoice</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.invoice}>
                <TableCell className="font-medium">
                  {invoice.invoice}
                </TableCell>
                <TableCell>{invoice.status}</TableCell>
                <TableCell>{invoice.method}</TableCell>
                <TableCell className="text-right">{invoice.amount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DemoSection>

      <DemoSection title="With Caption">
        <Table>
          <TableCaption>A list of recent invoices.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">Invoice</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.slice(0, 3).map((invoice) => (
              <TableRow key={invoice.invoice}>
                <TableCell className="font-medium">
                  {invoice.invoice}
                </TableCell>
                <TableCell>{invoice.status}</TableCell>
                <TableCell>{invoice.method}</TableCell>
                <TableCell className="text-right">{invoice.amount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DemoSection>
    </ComponentPage>
  );
}
