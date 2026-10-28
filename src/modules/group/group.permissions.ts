// src/modules/group/group.permissions.ts
// Role-based access control matrix and permission verification helpers for group chats.

import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { chats, chatMembers, ChatMember, ChatRole, Chat } from "../../db/schema";
import { HttpError } from "../auth/auth.service";

export type { ChatRole };

export type GroupAction =
  | "group:view"
  | "group:rename"
  | "group:add_member"
  | "group:remove_member"
  | "group:change_role"
  | "group:transfer_owner"
  | "group:delete"
  | "message:send"
  | "message:react";

const ALL: ChatRole[] = ["owner", "admin", "member"];

export const ALLOWED: Record<GroupAction, ChatRole[]> = {
  "group:view": ALL,
  "group:rename": ["owner", "admin"],
  "group:add_member": ["owner", "admin"],
  "group:remove_member": ["owner", "admin"],
  "group:change_role": ["owner"], // only the owner promotes or demotes
  "group:transfer_owner": ["owner"],
  "group:delete": ["owner"],
  "message:send": ALL,
  "message:react": ALL,
};

// Retrieves membership row for a user in a chat or null if not a member
export async function getMembership(
  chatId: string,
  userId: string
): Promise<ChatMember | null> {
  const [member] = await db
    .select()
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
    .limit(1);

  return member || null;
}

// Requires user to be an active member of the chat; returns membership and chat row
// Throws 404 (NOT 403) to prevent leaking chat existence to non-members
export async function requireMember(
  chatId: string,
  userId: string
): Promise<{ member: ChatMember; chat: Chat }> {
  const [chat] = await db
    .select()
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1);

  if (!chat) {
    throw new HttpError(404, "Chat not found");
  }

  const member = await getMembership(chatId, userId);
  if (!member) {
    throw new HttpError(404, "Chat not found");
  }

  return { member, chat };
}

// Checks if the user has permission to perform the requested action
export async function requirePermission(
  chatId: string,
  userId: string,
  action: GroupAction
): Promise<{ member: ChatMember; chat: Chat }> {
  const { member, chat } = await requireMember(chatId, userId);

  // Group-specific actions require the chat type to be 'group'
  if (action.startsWith("group:") && chat.type !== "group") {
    throw new HttpError(400, "Not a group chat");
  }

  const allowedRoles = ALLOWED[action];
  if (!allowedRoles || !allowedRoles.includes(member.role)) {
    throw new HttpError(403, "Forbidden");
  }

  return { member, chat };
}

// Determines if an actor role can remove or kick a target role
// Owner can remove admin or member; admin can remove member only; nobody can remove owner
export function canRemoveTarget(actorRole: ChatRole, targetRole: ChatRole): boolean {
  if (targetRole === "owner") {
    return false;
  }
  if (actorRole === "owner") {
    return true;
  }
  if (actorRole === "admin" && targetRole === "member") {
    return true;
  }
  return false;
}

