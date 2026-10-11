import { auth } from "@clerk/nextjs/server"
import { listConnectedAccounts } from "@/features/accounts/data"
import { AccountsManager } from "@/features/accounts/components/accounts-manager"

export default async function AccountsPage() {
  const { orgId } = await auth()
  const accounts = orgId ? await listConnectedAccounts(orgId) : []

  return <AccountsManager initialAccounts={accounts} />
}
