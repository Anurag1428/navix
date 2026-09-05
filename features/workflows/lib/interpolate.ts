type OutputMap = Record<string, unknown>

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g

function resolvePath(source: unknown, path: string): unknown {
    const tokens = path.match(/[^.[\]]+/g) ?? []
    let current: unknown = source
    for (const token of tokens) {
        if (current == null || typeof current !== "object") return undefined
        current = (current as Record<string, unknown>)[token]
    }
    return current
}

function formatValue(value: unknown): string {
    if (value === undefined || value === null) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value)
}

export function interpolate(text: string, outputs: OutputMap): string {
    return text.replace(PLACEHOLDER, (match, raw: string) => {
        const trimmed = raw.trim()
        const dot = trimmed.indexOf(".")
        if (dot === -1) return ""
        const nodeId = trimmed.slice(0, dot)
        const path = trimmed.slice(dot + 1)
        const source = outputs[nodeId]
        if (source === undefined) return ""
        return formatValue(resolvePath(source, path))
    })
}