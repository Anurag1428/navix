"use client"

import { useState, useTransition } from "react"
import { Globe, Plus, Trash2, ExternalLink, CheckCircle2, Loader2, Sparkles, AlertCircle } from "lucide-react"

import type { ConnectedAccount } from "@/lib/db/schema"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  deleteAccountAction,
  finishConnectingAccountAction,
  openAccountBrowserAction,
  startConnectingAccountAction,
} from "../actions"

const PLATFORMS = [
  {
    id: "wellfound",
    name: "Wellfound (AngelList)",
    defaultUrl: "https://wellfound.com/login",
    desc: "Startup tech jobs, frontend, fullstack & remote roles",
  },
  {
    id: "workatastartup",
    name: "YC (Work at a Startup)",
    defaultUrl: "https://www.workatastartup.com",
    desc: "Y Combinator-backed startups, founder outreach & jobs",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    defaultUrl: "https://www.linkedin.com/login",
    desc: "Professional network, job listings & applications",
  },
  {
    id: "custom",
    name: "Custom Website",
    defaultUrl: "https://",
    desc: "Any other career portal or login page",
  },
]

export function AccountsManager({ initialAccounts }: { initialAccounts: ConnectedAccount[] }) {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>(initialAccounts)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState("wellfound")
  const [accountName, setAccountName] = useState("")
  const [loginUrl, setLoginUrl] = useState("https://wellfound.com/login")

  // Connection session state
  const [isConnecting, setIsConnecting] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSelectPlatform = (id: string) => {
    setSelectedPlatform(id)
    const plat = PLATFORMS.find((p) => p.id === id)
    if (plat) {
      setLoginUrl(plat.defaultUrl)
      if (!accountName || PLATFORMS.some((p) => p.name.includes(accountName))) {
        setAccountName(plat.id === "custom" ? "My Account" : `My ${plat.name.split(" ")[0]}`)
      }
    }
  }

  const handleStartLogin = async () => {
    setError(null)
    setIsConnecting(true)
    try {
      const res = await startConnectingAccountAction({
        platform: selectedPlatform,
        loginUrl: loginUrl.trim(),
      })
      setActiveSessionId(res.sessionId)
    } catch (err: any) {
      setError(err?.message || "Failed to open browser")
      setIsConnecting(false)
    }
  }

  const handleSaveConnection = () => {
    if (!activeSessionId) return
    setError(null)

    startTransition(async () => {
      try {
        const newAccount = await finishConnectingAccountAction({
          sessionId: activeSessionId,
          platform: selectedPlatform,
          name: accountName.trim() || `${selectedPlatform} Account`,
          loginUrl: loginUrl.trim(),
        })

        setAccounts((prev) => [newAccount, ...prev.filter((a) => a.id !== newAccount.id)])
        setIsDialogOpen(false)
        setIsConnecting(false)
        setActiveSessionId(null)
        setAccountName("")
      } catch (err: any) {
        setError(err?.message || "Failed to save account")
      }
    })
  }

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to remove this connected account?")) return
    startTransition(async () => {
      await deleteAccountAction(id)
      setAccounts((prev) => prev.filter((a) => a.id !== id))
    })
  }

  const handleOpenExisting = (id: string) => {
    startTransition(async () => {
      try {
        await openAccountBrowserAction(id)
      } catch (err: any) {
        alert(err?.message || "Failed to open browser")
      }
    })
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Connected Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Log in once here. Your workflows will use these authenticated profiles without needing throwaway login steps.
          </p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="size-4" />
              <span>Connect Account</span>
            </Button>
          </DialogTrigger>

          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Connect a Platform Account</DialogTitle>
              <DialogDescription>
                Navix will open a clean Chrome window on your laptop so you can log in peacefully.
              </DialogDescription>
            </DialogHeader>

            {!isConnecting ? (
              <div className="flex flex-col gap-4 py-2">
                {/* Platform Selection */}
                <div className="flex flex-col gap-2">
                  <Label>Platform</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {PLATFORMS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectPlatform(p.id)}
                        className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all ${
                          selectedPlatform === p.id
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <span className="font-medium text-sm">{p.name}</span>
                        <span className="text-[11px] text-muted-foreground line-clamp-1">{p.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Friendly Name */}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="account-name">Friendly Name / Label</Label>
                  <Input
                    id="account-name"
                    placeholder="e.g. My Wellfound, Work LinkedIn"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Give this login a name you will recognize when selecting it on your canvas nodes.
                  </p>
                </div>

                {/* Login URL */}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="login-url">Login URL</Label>
                  <Input
                    id="login-url"
                    value={loginUrl}
                    onChange={(e) => setLoginUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>

                {error && (
                  <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md flex items-center gap-2">
                    <AlertCircle className="size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <DialogFooter className="mt-2">
                  <Button type="button" onClick={handleStartLogin} className="w-full gap-2">
                    <ExternalLink className="size-4" />
                    <span>Launch Chrome & Log In</span>
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              /* Browser Is Currently Open State */
              <div className="flex flex-col gap-4 py-4">
                <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-primary font-medium text-sm">
                    <Sparkles className="size-4 animate-pulse" />
                    <span>Chrome window is open on your screen!</span>
                  </div>
                  <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4">
                    <li>Log in inside the Chrome window with your credentials or Google.</li>
                    <li>Solve any 2FA code or security check peacefully (no timer ticking!).</li>
                    <li>Once you see your feed, dashboard, or profile icon, click the green button below.</li>
                  </ol>
                </div>

                {error && (
                  <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md flex items-center gap-2">
                    <AlertCircle className="size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <DialogFooter className="flex-col sm:flex-col gap-2 mt-2">
                  <Button
                    type="button"
                    onClick={handleSaveConnection}
                    disabled={isPending}
                    className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    <span>I've Logged In — Save & Close Chrome</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setIsConnecting(false)
                      setActiveSessionId(null)
                    }}
                    className="w-full text-xs"
                  >
                    Cancel
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Accounts List */}
      {accounts.length === 0 ? (
        <Card className="border-dashed p-10 flex flex-col items-center text-center gap-3">
          <div className="size-12 rounded-full bg-muted flex items-center justify-center">
            <Globe className="size-6 text-muted-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">No connected accounts yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mt-1">
              Connect your Wellfound, LinkedIn, or other accounts so your workflows can run fully authenticated.
            </p>
          </div>
          <Button onClick={() => setIsDialogOpen(true)} variant="outline" className="gap-2 mt-2">
            <Plus className="size-4" />
            <span>Connect First Account</span>
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((acc) => (
            <Card key={acc.id} className="flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="capitalize text-xs font-semibold">
                    {acc.platform}
                  </Badge>
                  <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 gap-1 text-[11px]">
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>{acc.status}</span>
                  </Badge>
                </div>
                <CardTitle className="text-lg mt-2">{acc.name}</CardTitle>
                <CardDescription className="text-xs truncate">
                  Profile: <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{acc.profileDir}</code>
                </CardDescription>
              </CardHeader>

              <CardContent className="text-xs text-muted-foreground pb-3">
                Created: {new Date(acc.createdAt).toLocaleDateString()}
              </CardContent>

              <CardFooter className="pt-2 border-t flex items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenExisting(acc.id)}
                  disabled={isPending}
                  className="text-xs gap-1.5 h-8"
                  title="Open Chrome with this profile to inspect or update"
                >
                  <ExternalLink className="size-3" />
                  <span>Inspect</span>
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(acc.id)}
                  disabled={isPending}
                  className="text-xs text-destructive hover:text-destructive h-8 px-2"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
