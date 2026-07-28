"use client"

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"

export default function Page() {
  return (
    <main className="relative overflow-hidden px-6 py-16 sm:px-8 lg:px-12">
      <div className="absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.9),_rgba(255,255,255,0)_60%),linear-gradient(135deg,_rgba(15,23,42,0.05),_rgba(15,23,42,0)_45%)] dark:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_rgba(255,255,255,0)_60%),linear-gradient(135deg,_rgba(255,255,255,0.05),_rgba(255,255,255,0)_45%)]" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
        <section className="max-w-2xl space-y-6">
          <div className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Clerk enabled
          </div>
          <div className="space-y-4">
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              A signed-in workspace you can start using right now.
            </h1>
            <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
              Clerk is wired into the app shell, the auth routes are live, and the header
              now shows the right controls for signed-in and signed-out users.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Show when="signed-out">
              <div className="flex flex-wrap gap-3">
                <SignUpButton>
                  <Button size="lg">Create account</Button>
                </SignUpButton>
                <SignInButton>
                  <Button size="lg" variant="outline">
                    Sign in
                  </Button>
                </SignInButton>
              </div>
            </Show>
            <Show when="signed-in">
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
                <UserButton />
                <div>
                  <p className="text-sm font-medium">You are signed in.</p>
                  <p className="text-sm text-muted-foreground">
                    Open your account menu from the avatar in the header.
                  </p>
                </div>
              </div>
            </Show>
          </div>
        </section>

        <aside className="grid w-full max-w-md gap-4">
          <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">What is ready</p>
            <ul className="mt-4 space-y-3 text-sm leading-6">
              <li>ClerkProvider is wrapped around the app.</li>
              <li>Sign-in and sign-up routes render Clerk UI.</li>
              <li>The shadcn theme keeps Clerk components on-brand.</li>
            </ul>
          </div>
          <div className="rounded-3xl border border-border bg-muted/40 p-6 text-sm leading-6 text-muted-foreground shadow-sm">
            Use the sign-up button in the header to create the first test account, then
            open the avatar menu to verify the signed-in state.
          </div>
        </aside>
      </div>
    </main>
  )
}
