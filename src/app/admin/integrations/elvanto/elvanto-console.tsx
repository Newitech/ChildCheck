"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown, Download, Info, Plug, Upload, UserPlus } from "lucide-react";

import { ImportTab } from "./import-tab";
import { ExportTab } from "./export-tab";
import { QuickAddTab } from "./quick-add-tab";
import { FieldMappingReference } from "./field-mapping-ref";

/**
 * Top-level admin console for the Elvanto connector.
 *
 * Three tabs (Import / Export / Quick add) + a sticky "Field mapping
 * reference" collapsible at the bottom + the data-minimisation note.
 */
export function ElvantoConsole() {
  return (
    <div className="space-y-6">
      <Card className="bg-amber-50/40 border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-900/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Data minimisation note
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            Elvanto address fields (<span className="font-medium">Address</span>,
            <span className="font-medium"> Suburb</span>,
            <span className="font-medium"> State</span>,
            <span className="font-medium"> Postcode</span>,
            <span className="font-medium"> Country</span>) are{" "}
            <span className="font-medium">not stored</span> in ChildCheck by
            default — child-safety data minimisation. They are accepted on
            import (for round-trip friendliness) but silently ignored. They
            will be empty on the export-back-to-Elvanto CSV.
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="import" className="w-full">
        <TabsList className="grid w-full sm:w-auto grid-cols-3">
          <TabsTrigger value="import" className="gap-1.5">
            <Upload className="h-4 w-4" /> Import
          </TabsTrigger>
          <TabsTrigger value="export" className="gap-1.5">
            <Download className="h-4 w-4" /> Export
          </TabsTrigger>
          <TabsTrigger value="quick" className="gap-1.5">
            <UserPlus className="h-4 w-4" /> Quick add
          </TabsTrigger>
        </TabsList>
        <TabsContent value="import" className="mt-4">
          <ImportTab />
        </TabsContent>
        <TabsContent value="export" className="mt-4">
          <ExportTab />
        </TabsContent>
        <TabsContent value="quick" className="mt-4">
          <QuickAddTab />
        </TabsContent>
      </Tabs>

      <FieldMappingReference />

      <Card className="bg-muted/30">
        <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Elvanto</span> is a
            church management system. This connector is read/write on
            ChildCheck — Elvanto itself is never contacted directly.
          </div>
          <Button asChild variant="ghost" size="sm" className="text-primary">
            <a href="/admin/data">
              <Plug className="mr-1.5 h-3.5 w-3.5" /> Generic CSV import / export
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
