import { json } from "@remix-run/node";
import prisma from "../db.server";

export async function loader() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ status: "ok" }, { status: 200 });
  } catch {
    return json({ status: "error" }, { status: 503 });
  }
}
