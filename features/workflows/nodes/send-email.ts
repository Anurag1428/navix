import { resend } from "@/lib/resend"

export async function sendEmailNode({
    values,
    nodeId,
}: {
    values: Record<string, string>
    nodeId?: string
}) {
    const { recipient, subject, body } = values

    console.log(`[Send Email] START (nodeId: ${nodeId ?? "unknown"}, subject: "${subject}")`)

    if (!recipient) {
        throw new Error("Send Email: recipient is empty.")
    }
    if (!subject) {
        throw new Error("Send Email: subject is empty.")
    }
    if (!body) {
        throw new Error("Send Email: body is empty.")
    }

    const { data, error } = await resend.emails.send({
        from: "onboarding@resend.dev",
        to: [recipient],
        subject,
        html: body,
    })

    if (error) {
        console.error(`[Send Email] FAILED (nodeId: ${nodeId ?? "unknown"}): ${error.message}`)
        throw new Error(`Send Email: ${error.message}`)
    }

    console.log(`[Send Email] SUCCESS (nodeId: ${nodeId ?? "unknown"}, emailId: ${data?.id ?? "unknown"})`)

    return {
        id: data?.id,
    }
}
