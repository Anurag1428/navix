import { clerkMiddleware } from "@clerk/nextjs/server"

export default clerkMiddleware(async (auth, req) => {
  if (req.nextUrl.pathname === "/") {
    const { isAuthenticated, redirectToSignIn } = await auth()

    if (!isAuthenticated) {
      return redirectToSignIn()
    }
  }
})

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
}
