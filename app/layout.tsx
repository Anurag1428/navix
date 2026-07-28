import { ClerkProvider, Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs"
import { shadcn } from "@clerk/ui/themes"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <ClerkProvider appearance={{ theme: shadcn }}>
          <ThemeProvider>
            <header className="border-b border-border/80 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
              <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
                <div>
                  <div className="text-lg font-semibold tracking-tight">Navix</div>
                  <div className="text-sm text-muted-foreground">
                    A simple, local-first app shell
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Show when="signed-out">
                    <div className="flex items-center gap-2">
                      <SignInButton>
                        <button className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
                          Sign in
                        </button>
                      </SignInButton>
                      <SignUpButton>
                        <button className="inline-flex h-9 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:opacity-90">
                          Sign up
                        </button>
                      </SignUpButton>
                    </div>
                  </Show>
                  <Show when="signed-in">
                    <UserButton />
                  </Show>
                </div>
              </div>
            </header>
            {children}
            <Toaster />
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  )
}
