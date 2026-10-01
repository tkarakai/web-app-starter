import { render, screen } from "@testing-library/react";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { describe, expect, test, vi } from "vitest";
import { createColumns } from "../../src/components/waitlist/columns";
import type { WaitlistEntry } from "../../src/components/waitlist/waitlist-actions-context";

vi.mock("../../src/components/waitlist/token-viewer-dialog", () => ({ TokenViewerDialog: () => null }));

function MetadataCells({ meta }: { meta: string }) {
  const columns = createColumns({ searchTerm: "" }).filter(column =>
    ["superpowers", "excitement", "role", "company", "metadata"].includes(column.id ?? ""),
  );
  const entry = { _id: "entry", _creationTime: 0, email: "buyer@example.test", meta, status: "waiting", createdAt: 0, invitationExpired: false } as WaitlistEntry;
  const table = useReactTable({ data: [entry], columns, getCoreRowModel: getCoreRowModel() });
  return <div>{table.getRowModel().rows[0].getVisibleCells().map(cell => (
    <div key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</div>
  ))}</div>;
}

describe("waitlist metadata cells", () => {
  test("keeps sample labels and profile fields readable", () => {
    render(<MetadataCells meta={JSON.stringify({ superpowers: ["coffee-to-code"], excitement: ["cant-wait"], role: "founder", company: "Acme", useCase: "Internal tools" })} />);
    for (const text of ["Coffee to code", "Can't wait", "Founder", "Acme", "Internal tools"]) expect(screen.getByText(text)).toBeInTheDocument();
  });

  test.each(["{}", "null", "[]", "{", '{"superpowers":{},"excitement":[{}],"role":{},"company":[],"useCase":{}}', '{"superpowers":["toString"],"excitement":["__proto__"],"role":"constructor"}'])("renders safely for custom or legacy shapes: %s", (meta) => {
    expect(() => render(<MetadataCells meta={meta} />)).not.toThrow();
  });

  test("shows arbitrary metadata as escaped text", () => {
    const meta = '{"custom":{"notes":"<img src=x onerror=alert(1)>"}}';
    const { container } = render(<MetadataCells meta={meta} />);
    expect(screen.getByText("View metadata")).toBeInTheDocument();
    expect(screen.getByText(meta)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
