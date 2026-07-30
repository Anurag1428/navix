"use client"

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs"

export default function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center gap-3 p-6">
      <UserButton />
      <OrganizationSwitcher hidePersonal />
    </div>
  )
}
