"use client";

import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

type Column = { key: string; label: string };
type Row = Record<string, string | number>;

/** A cell that starts with =, +, - or @ is read as a formula by spreadsheets. */
function csvCell(value: string | number) {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Print (or save as PDF from the print dialog) and CSV export for a report. */
export function ReportActions({
  title,
  columns,
  rows,
  canExport,
}: {
  title: string;
  columns: Column[];
  rows: Row[];
  canExport: boolean;
}) {
  function downloadCsv() {
    const lines = [columns.map((column) => csvCell(column.label)).join(",")];
    for (const row of rows) {
      lines.push(columns.map((column) => csvCell(row[column.key] ?? "")).join(","));
    }
    // The BOM makes Excel read the file as UTF-8 (₱, ñ and so on).
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Button variant="outline" onClick={() => window.print()} disabled={rows.length === 0}>
        <Printer /> Print / Save as PDF
      </Button>
      {canExport ? (
        <Button variant="outline" onClick={downloadCsv} disabled={rows.length === 0}>
          <Download /> Export CSV (Excel)
        </Button>
      ) : null}
    </>
  );
}
