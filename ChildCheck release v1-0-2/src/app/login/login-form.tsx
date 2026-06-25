"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { Loader2, LogIn, ArrowLeft, AlertCircle } from "lucide-react";

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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BrandMark } from "@/components/domain/brand-mark";

const LoginSchema = z.object({
  username: z.string().trim().min(1, "Enter your username"),
  password: z.string().min(1, "Enter your password or PIN"),
});

type LoginValues = z.infer<typeof LoginSchema>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callback") || "/admin";

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { username: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await signIn("credentials", {
        redirect: false,
        username: values.username,
        password: values.password,
        callbackUrl,
      });
      if (!res || res.error) {
        // Stage 16: the rate-limit middleware returns 429 when the login
        // endpoint is hammered (>10/min/username+IP). NextAuth surfaces this
        // as `{ error: "[error]" }` with `status: 429` (or, in some flows,
        // as a generic CredentialsSignin error). Check the status code first.
        if (res?.status === 429) {
          setError("Too many sign-in attempts. Please wait a minute and try again.");
        } else {
          setError("Invalid username or password.");
        }
        setSubmitting(false);
        return;
      }
      // On success, push to /admin — the admin layout re-routes
      // non-admin/PM/security roles to /volunteer or /kiosk appropriately.
      const dest = res.url && !res.url.includes("error") ? "/admin" : "/admin";
      router.push(dest);
      router.refresh();
    } catch (err) {
      console.error("[login] submission error:", err);
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md shadow-sm">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <LogIn className="h-6 w-6" />
        </div>
        <div>
          <CardTitle className="text-2xl flex items-center justify-center gap-2">
            <BrandMark size="sm" /> Sign in
          </CardTitle>
          <CardDescription className="mt-1">
            Admin, people-manager, security, teacher and volunteer accounts.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn&apos;t sign you in</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="login-username">Username</FormLabel>
                  <FormControl>
                    <Input
                      id="login-username"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      placeholder="admin"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="login-password">Password or PIN</FormLabel>
                  <FormControl>
                    <Input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-11"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…
                </>
              ) : (
                <>
                  <LogIn className="mr-2 h-4 w-4" /> Sign in
                </>
              )}
            </Button>
          </form>
        </Form>

        <div className="mt-4 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Home
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/kiosk">Open kiosk</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
