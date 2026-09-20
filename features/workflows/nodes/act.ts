// import type { Stagehand } from "@browserbasehq/stagehand"

// /**
//  * Executes a Stagehand act command with the given instruction.
//  * @param stagehand - The Stagehand instance to execute the action
//  * @param instruction - The natural language instruction for the browser action
//  * @returns Object containing success status, message, and current URL
//  */
// export async function actNode({
//     stagehand,
//     instruction,
// }: {
//     stagehand: Stagehand
//     instruction: string
// }) {
//     if (!instruction) {
//         throw new Error("Act: instruction is empty.")
//     }

//     // Execute the browser action using Stagehand's act method
//     const result = await stagehand.act(instruction)

//     // Get the current page URL after the action
//     const page = await stagehand.browser.context.activePage()
//     const resolvedUrl = page ? await page.url() : ""

//     return {
//         success: true,
//         message: result.data.message ?? "Action completed",
//         url: resolvedUrl,
//     }
// }


import type { Stagehand } from "@browserbasehq/stagehand"

/**
 * Executes a Stagehand act command with the given instruction.
 * @param stagehand - The Stagehand instance to execute the action
 * @param instruction - The natural language instruction for the browser action
 * @returns Object containing success status, message, and current URL
 */
export async function actNode({
    stagehand,
    instruction,
}: {
    stagehand: Stagehand
    instruction: string
}) {
    if (!instruction) {
        throw new Error("Act: instruction is empty.")
    }

    const result = await stagehand.act(instruction)

    const page = await stagehand.browser.context.activePage()
    const resolvedUrl = page ? await page.url() : ""

    // v4's act() reports failure via `success: false` rather than
    // throwing. Surface that as a real error so run-workflow.ts's
    // retryStep can actually retry it, and so a failed click doesn't
    // get reported upstream as a success.
    if (!result.data.success) {
        throw new Error(
            `Act: action failed — ${result.data.message ?? "no reason given"}`
        )
    }

    return {
        success: true,
        message: result.data.message ?? "Action completed",
        url: resolvedUrl,
    }
}   