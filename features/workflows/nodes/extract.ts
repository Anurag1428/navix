import type { Stagehand } from "@browserbasehq/stagehand"

export async function extractNode({
    stagehand,
    instruction,
}: {
    stagehand: Stagehand
    instruction: string
}) {
    if (!instruction) {
        throw new Error(
            "Extract: instruction is empty."
        )
    }

    const result = await stagehand.extract(instruction)

    return {
        result: result.data.extraction,
    }
}
