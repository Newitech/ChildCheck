"use client";

import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Plug, Upload } from "lucide-react";

import { ExportTab } from "./export-tab";
import { ImportTab } from "./import-tab";

/**
 * Top-level console for the Stage 12 Import / Export admin page.
 *
 * Two tabs: Export (download CSVs of any list) + Import (template downloads,
 * file upload, dry-run preview, atomic real import). Plus a quick-link to
 * the Elvanto connector (Stage 17) at the top.
 */
export function DataConsole() {
  return (
    <div className="space-y-4">
      <Card className="bg-muted/30">
        <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="text-sm">
            <span className="font-medium">Elvanto connector</span>
            <span className="text-muted-foreground">
              {" "}— import/export people &amp; families from/to an Elvanto
              CSV. Dry-run preview, idempotent matching, quick-add a single
              record.
            </span>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/integrations/elvanto">
              <Plug className="mr-1.5 h-4 w-4" /> Open Elvanto connector
            </Link>
          </Button>
        </CardContent>
      </Card>

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
    </div>
  );
}
