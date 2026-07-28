"use client"

import { SignIn } from "@clerk/nextjs"
import { shadcn } from "@clerk/ui/themes"

export default function SignInPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-16">
      <SignIn
        appearance={{ theme: shadcn }}
        path="/sign-in"
        routing="path"
      />
    </main>
  )
}
