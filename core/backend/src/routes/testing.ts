import { Hono } from "hono";
import { registrationFixtures } from "../testing/registration-fixtures.js";

export const testingRouter = new Hono();

testingRouter.get("/registration-fixtures", (c) => {
  return c.json({ fixtures: registrationFixtures });
});
