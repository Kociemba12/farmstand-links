import { Hono } from "hono";

export const notifyNewFarmstandRouter = new Hono();

// Kept for backwards compatibility — mobile calls this endpoint after a farmstand insert.
// The rich admin email is sent via hyper-worker directly from the mobile client.
notifyNewFarmstandRouter.post("/", (c) => c.json({ ok: true }));
