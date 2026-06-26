"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, BookOpen } from "lucide-react";

interface MappingRow {
  elvantoField: string;
  variants: string[];
  childCheckField: string;
  notes?: string;
}

const MAPPING: MappingRow[] = [
  {
    elvantoField: "First Name",
    variants: ["First Name", "Firstname", "First_Name", "GivenName"],
    childCheckField: "Person.firstName",
    notes: "Required.",
  },
  {
    elvantoField: "Middle Name",
    variants: ["Middle Name", "MiddleName", "Middle_Name", "Middle Initial", "MI"],
    childCheckField: "Person.middleName",
    notes: "Optional — full middle name or just an initial.",
  },
  {
    elvantoField: "Last Name",
    variants: ["Last Name", "Lastname", "Last_Name", "Surname"],
    childCheckField: "Person.lastName",
    notes: "Required.",
  },
  {
    elvantoField: "Email",
    variants: ["Email", "EmailAddress"],
    childCheckField: "Person.email",
    notes: "Used as the adult match key for idempotency.",
  },
  {
    elvantoField: "Mobile",
    variants: ["Mobile", "Phone", "MobilePhone"],
    childCheckField: "Person.phone",
  },
  {
    elvantoField: "Birthday",
    variants: ["Birthday", "DOB", "Date of Birth"],
    childCheckField: "Person.dateOfBirth",
    notes: "ISO YYYY-MM-DD, DD/MM/YYYY, or MM/DD/YYYY.",
  },
  {
    elvantoField: "Gender",
    variants: ["Gender", "Sex"],
    childCheckField: "Person.gender",
    notes: "Male / Female / Other.",
  },
  {
    elvantoField: "Family ID",
    variants: ["Family ID", "FamilyID", "Household ID"],
    childCheckField: "(grouping key)",
    notes: "Rows sharing this ID are placed in the same Family.",
  },
  {
    elvantoField: "Family Name",
    variants: ["Family Name", "FamilyName", "Household Name"],
    childCheckField: "Family.familyName",
    notes: "Used when creating a new Family row.",
  },
  {
    elvantoField: "Family Role",
    variants: ["Family Role", "FamilyRole", "Role"],
    childCheckField: "FamilyMember.role",
    notes: "Head of Household/Spouse/Adult → PrimaryCarer; Child → Child; Other/Visitor → EmergencyContact (default).",
  },
  {
    elvantoField: "School Grade",
    variants: ["School Grade", "SchoolGrade", "Grade", "Year Level"],
    childCheckField: "Person.schoolGrade",
  },
  {
    elvantoField: "Medical Info",
    variants: ["Medical Info", "MedicalInformation", "Medical Notes"],
    childCheckField: "Person.medicalNotes / Person.allergies",
    notes: "Values containing 'allerg' go to allergies; the rest to medicalNotes.",
  },
  {
    elvantoField: "Allergies",
    variants: ["Allergies", "Allergy"],
    childCheckField: "Person.allergies",
  },
  {
    elvantoField: "Marital Status",
    variants: ["Marital Status", "MaritalStatus"],
    childCheckField: "(not stored)",
    notes: "Read but not persisted. 'Visitor' value flags the person as a visitor.",
  },
  {
    elvantoField: "Address / Suburb / State / Postcode / Country",
    variants: ["Address", "Suburb", "State", "Postcode", "Country"],
    childCheckField: "(not stored)",
    notes: "Child-safety data minimisation. Accepted on import, ignored.",
  },
  {
    elvantoField: "Photo URL",
    variants: ["Photo URL", "PhotoUrl", "Photo"],
    childCheckField: "(not stored)",
    notes: "Photo storage in ChildCheck is via the photo upload UI (encrypted at rest).",
  },
  {
    elvantoField: "Created Date",
    variants: ["Created Date", "CreatedDate"],
    childCheckField: "(not stored)",
    notes: "ChildCheck records its own createdAt on insert.",
  },
];

/**
 * Expandable reference showing how each Elvanto field maps to a ChildCheck
 * field. Visible by default for transparency; can be collapsed.
 */
export function FieldMappingReference() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center justify-between gap-2 w-full text-left"
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <BookOpen className="h-4 w-4" />
                </span>
                <div>
                  <CardTitle className="text-base">Field mapping reference</CardTitle>
                  <CardDescription className="text-sm mt-0.5">
                    How Elvanto fields map to ChildCheck fields (and which are
                    ignored).
                  </CardDescription>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="shrink-0">
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
                />
                {open ? "Hide" : "Show"}
              </Button>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="text-left font-medium px-3 py-2 w-[200px]">Elvanto field</th>
                    <th className="text-left font-medium px-3 py-2 w-[260px]">Accepted variants</th>
                    <th className="text-left font-medium px-3 py-2 w-[260px]">ChildCheck field</th>
                    <th className="text-left font-medium px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {MAPPING.map((row) => (
                    <tr key={row.elvantoField} className="border-t">
                      <td className="px-3 py-2 font-medium">{row.elvantoField}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {row.variants.join(", ")}
                      </td>
                      <td className="px-3 py-2">
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">
                          {row.childCheckField}
                        </code>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {row.notes}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Badge variant="outline" className="text-[10px]">
                Case-insensitive matching
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                Space / underscore / hyphen treated as equal
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                Unknown columns silently ignored
              </Badge>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
