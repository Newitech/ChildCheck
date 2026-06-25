"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Upload } from "lucide-react";

import { ExportTab } from "./export-tab";
import { ImportTab } from "./import-tab";

/**
 * Top-level console for the Stage 12 Import / Export admin page.
 *
 * Two tabs: Export (download CSVs of any list) + Import (template downloads,
 * file upload, dry-run preview, atomic real import).
 */
export function DataConsole() {
  return (
    <Tabs defaultValue="export" className="w-full">
      <TabsList className="grid w-full sm:w-auto grid-cols-2">
        <TabsTrigger value="export" className="gap-1.5">
          <Download className="h-4 w-4" /> Export
        </TabsTrigger>
        <TabsTrigger value="import" className="gap-1.5">
          <Upload className="h-4 w-4" /> Import
        </TabsTrigger>
      </TabsList>
      <TabsContent value="export" className="mt-4">
        <ExportTab />
      </TabsContent>
      <TabsContent value="import" className="mt-4">
        <ImportTab />
      </TabsContent>
    </Tabs>
  );
}
