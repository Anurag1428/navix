"use client"

import { SignUp } from "@clerk/nextjs"
import { shadcn } from "@clerk/ui/themes"

export default function SignUpPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-16">
      <SignUp
        appearance={{ theme: shadcn }}
        path="/sign-up"
        routing="path"
      />
    </main>
  )
}
