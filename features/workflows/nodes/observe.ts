import type { Stagehand } from "@browserbasehq/stagehand"

export async function observeNode({
    stagehand,
    instruction,
}: {
    stagehand: Stagehand
    instruction: string
}) {
    if (!instruction) {
        throw new Error("Observe: instruction is empty.")
    }

    const result = await stagehand.observe(instruction)
    const matches = result.data

    return {
        matches,
        selector: matches[0]?.selector ?? "",
        description: matches[0]?.description ?? "",
    }
}