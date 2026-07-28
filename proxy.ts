import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"

const isTestRoute = createRouteMatcher(["/test(.*)"])

export default clerkMiddleware(async (auth, req) => {
  if (isTestRoute(req)) {
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
