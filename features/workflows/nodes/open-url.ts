import type { Stagehand } from "@browserbasehq/stagehand"

export async function openUrl({
    stagehand,
    url,
}: {
    stagehand: Stagehand
    url: string
}) {
    if (!url) {
        throw new Error(
            "Open URL: nothing to navigate to. The URL field is empty — make sure upstream placeholders resolved (they must include a .path)."
        )
    }

    const page = await stagehand.browser.context.activePage()

    if (!page) {
        throw new Error("No active browser page is available.")
    }

    await page.goto(url, {
        waitUntil: "load",
        timeout: 30_000,
    })

    const resolvedUrl = await page.url()
    const resolvedTitle = await page.title()

    return {
        url: resolvedUrl,
        title: resolvedTitle,
    }
}