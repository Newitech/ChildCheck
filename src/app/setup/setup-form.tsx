"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { Loader2, ShieldCheck, ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BrandMark } from "@/components/domain/brand-mark";

const SetupSchema = z
  .object({
    organisationName: z
      .string()
      .trim()
      .min(1, "Organisation name is required"),
    firstName: z.string().trim().min(1, "First name is required"),
    lastName: z.string().trim().min(1, "Last name is required"),
    email: z
      .string()
      .trim()
      .email("Email is invalid")
      .optional()
      .or(z.literal("")),
    username: z
      .string()
      .trim()
      .min(3, "Username must be at least 3 characters")
      .max(64)
      .regex(
        /^[A-Za-z0-9._-]+$/,
        "Letters, numbers, '.', '_' and '-' only",
      ),
    password: z.string().min(8, "Password must be at least 8 characters"),
    passwordConfirm: z.string().min(8, "Please confirm your password"),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Passwords do not match",
  });

type SetupValues = z.infer<typeof SetupSchema>;

export function SetupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<SetupValues>({
    resolver: zodResolver(SetupSchema),
    defaultValues: {
      organisationName: "",
      firstName: "",
      lastName: "",
      email: "",
      username: "",
      password: "",
      passwordConfirm: "",
    },
  });

  async function onSubmit(values: SetupValues) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationName: values.organisationName,
          firstName: values.firstName,
          lastName: values.lastName,
          email: values.email && values.email.length > 0 ? values.email : null,
          username: values.username,
          password: values.password,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };

      if (!res.ok || !data.ok) {
        setError(data.error ?? "Setup failed. Please try again.");
        setSubmitting(false);
        return;
      }

      // Sign in as the newly created admin, then go to /admin.
      const sign = await signIn("credentials", {
        redirect: false,
        username: values.username,
        password: values.password,
      });
      if (!sign || sign.error) {
        // Setup succeeded but auto-signin failed — punt to /login.
        router.push("/login?reason=setup-success");
        return;
      }
      router.push("/admin");
      router.refresh();
    } catch (err) {
      console.error("[setup] submission error:", err);
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-xl shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2">
          <BrandMark size="md" />
          <div>
            <CardTitle className="text-2xl">Welcome — let&apos;s set up {`ChildCheck`}</CardTitle>
            <CardDescription>
              Create your organisation and the first admin account. This only takes a minute.
            </CardDescription>
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          ChildCheck is a self-hosted system for churches, clubs, schools and childcare — built with
          Seventh-day Adventist organisations for Sabbath School, Pathfinders and Adventurers etc. in
          mind, but rebrandable for any organisation. After setup, you can apply a different
          organisation-type profile (Sunday Church, Scouts, Childcare, School, Club, or Custom) from
          the Admin settings.
        </p>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Setup failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
            noValidate
          >
            <FormField
              control={form.control}
              name="organisationName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organisation name</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="organization"
                      placeholder="e.g. Riverside SDA Church"
                      aria-describedby="organisationName-desc"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription id="organisationName-desc">
                    Shown in headers, the kiosk and printed labels.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin first name</FormLabel>
                    <FormControl>
                      <Input autoComplete="given-name" placeholder="Jane" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin last name</FormLabel>
                    <FormControl>
                      <Input autoComplete="family-name" placeholder="Admin" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Admin email (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="jane@example.org"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Stored as a contact only — not used for login.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Admin username</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="username"
                      placeholder="admin"
                      autoCapitalize="none"
                      autoCorrect="off"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    At least 3 characters. Letters, numbers, <code>.</code>, <code>_</code>, <code>-</code>.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>At least 8 characters.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="passwordConfirm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
              <Button asChild variant="ghost" size="sm" type="button">
                <Link href="/">
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Home
                </Link>
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="h-11 sm:w-auto"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Setting up…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="mr-2 h-4 w-4" /> Create admin &amp; sign in
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
