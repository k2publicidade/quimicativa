import { getChatGPTUser } from "../chatgpt-auth";
import { getD1 } from "../../db";

export type Actor = {
  userId: string;
  email: string;
  displayName: string;
  role: "ceo" | "manager" | "operator" | "viewer";
};

export async function getActor(): Promise<Actor | null> {
  const user = await getChatGPTUser();
  if (!user) return null;
  const db = getD1(),
    existing = await db
      .prepare("SELECT role FROM users WHERE id=?")
      .bind(user.userId)
      .first<{ role: Actor["role"] }>();
  if (existing) return { ...user, role: existing.role };
  const count = await db
      .prepare("SELECT COUNT(*) AS total FROM users")
      .first<{ total: number }>(),
    role: Actor["role"] = (count?.total ?? 0) === 0 ? "ceo" : "viewer",
    now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "INSERT INTO users (id,email,name,role,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(user.userId, user.email, user.displayName, role, now)
    .run();
  return { ...user, role };
}

export const canWrite = (actor: Actor) => actor.role !== "viewer";
export const canValidate = (actor: Actor) =>
  actor.role === "ceo" || actor.role === "manager";
export const canReadConfidential = (actor: Actor) => actor.role === "ceo";
