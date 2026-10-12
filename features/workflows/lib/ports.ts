import net from "net"

/**
 * Finds an available, random ephemeral port allocated by the operating system kernel.
 * Binds to 127.0.0.1 on port 0, reads the assigned port, and immediately closes the server.
 */
export function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate ephemeral port")))
        return
      }
      const port = address.port
      server.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
    server.on("error", reject)
  })
}
