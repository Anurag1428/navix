import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { parseTelegramCommand } from "../parser.ts"
import type { TelegramUpdate } from "../types.ts"

describe("Telegram Bot Command Parser", () => {
    it("parses simple /start command", () => {
        const update: TelegramUpdate = {
            update_id: 1,
            message: {
                message_id: 10,
                chat: { id: 123456, type: "private" },
                from: { id: 789, first_name: "Bruce", last_name: "Wayne" },
                date: 1700000000,
                text: "/start",
            },
        }

        const parsed = parseTelegramCommand(update)
        assert.ok(parsed)
        assert.equal(parsed.command, "start")
        assert.deepEqual(parsed.args, [])
        assert.equal(parsed.chatId, 123456)
        assert.equal(parsed.fromName, "Bruce Wayne")
    })

    it("parses /run command with workflow name argument", () => {
        const update: TelegramUpdate = {
            update_id: 2,
            message: {
                message_id: 11,
                chat: { id: 123456, type: "private" },
                from: { id: 789, first_name: "Clark" },
                date: 1700000000,
                text: "/run Apply To Wellfound Jobs",
            },
        }

        const parsed = parseTelegramCommand(update)
        assert.ok(parsed)
        assert.equal(parsed.command, "run")
        assert.deepEqual(parsed.args, ["Apply", "To", "Wellfound", "Jobs"])
        assert.equal(parsed.chatId, 123456)
        assert.equal(parsed.fromName, "Clark")
    })

    it("strips bot username suffix from command (group chat format)", () => {
        const update: TelegramUpdate = {
            update_id: 3,
            message: {
                message_id: 12,
                chat: { id: -100123456, type: "group" },
                date: 1700000000,
                text: "/list@NavixBot",
            },
        }

        const parsed = parseTelegramCommand(update)
        assert.ok(parsed)
        assert.equal(parsed.command, "list")
        assert.deepEqual(parsed.args, [])
        assert.equal(parsed.chatId, -100123456)
    })

    it("returns null for non-command messages", () => {
        const update: TelegramUpdate = {
            update_id: 4,
            message: {
                message_id: 13,
                chat: { id: 123456, type: "private" },
                date: 1700000000,
                text: "Hello bot, how are you?",
            },
        }

        const parsed = parseTelegramCommand(update)
        assert.equal(parsed, null)
    })

    it("returns null when message has no text (e.g. photo or document)", () => {
        const update: TelegramUpdate = {
            update_id: 5,
            message: {
                message_id: 14,
                chat: { id: 123456, type: "private" },
                date: 1700000000,
            },
        }

        const parsed = parseTelegramCommand(update)
        assert.equal(parsed, null)
    })
})
