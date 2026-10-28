// src/modules/group/group.service.ts
// Business logic for group chat lifecycle, membership updates, role changes, ownership transfers, and system message creation.

import crypto from "crypto";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  chats,
  chatMembers,
  messages,
  users,
  ChatRole,
} from "../../db/schema";
import { env } from "../../config/env";
import { HttpError } from "../auth/auth.service";
import {
  requirePermission,
  requireMember,
  getMembership,
  canRemoveTarget,
} from "./group.permissions";
import {
  CreateGroupInput,
  AddGroupMembersInput,
} from "./group.schemas";
import { getRealtimeManager } from "../../realtime/socket";

// Atomically allocates the next monotonic sequence number for a chat
export async function allocateChatSeq(chatId: string, tx: any = db): Promise<number> {
  const result = await tx
    .update(chats)
    .set({
      lastSeq: sql`${chats.lastSeq} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(chats.id, chatId))
    .returning({ lastSeq: chats.lastSeq });

  if (result.length === 0) {
    throw new HttpError(404, "Chat not found");
  }

  return result[0].lastSeq;
}

// Inserts an immutable system message with metadata and fallback body
export async function createSystemMessage(
  tx: any,
  chatId: string,
  actorId: string,
  meta: {
    action:
      | "member_added"
      | "member_removed"
      | "member_left"
      | "renamed"
      | "role_changed"
      | "ownership_transferred"
      | "group_created";
    actorId: string;
    targetIds?: string[];
    [key: string]: any;
  },
  fallbackText: string
) {
  const seq = await allocateChatSeq(chatId, tx);
  const [msg] = await tx
    .insert(messages)
    .values({
      chatId,
      senderId: actorId,
      clientMsgId: crypto.randomUUID(),
      seq,
      body: fallbackText,
      type: "system",
      meta,
    })
    .returning();

  return msg;
}

export class GroupService {
  // Creates a new group chat with creator as owner and specified members
  async createGroup(actorId: string, input: CreateGroupInput) {
    // Deduplicate and filter out creator from memberIds
    const uniqueMemberIds = Array.from(new Set(input.memberIds.filter((id) => id !== actorId)));

    const totalMembers = 1 + uniqueMemberIds.length;
    if (totalMembers > env.MAX_GROUP_MEMBERS) {
      throw new HttpError(
        400,
        `Group size exceeds maximum allowed limit of ${env.MAX_GROUP_MEMBERS} members`
      );
    }

    // Verify all specified user IDs exist in users table
    if (uniqueMemberIds.length > 0) {
      const foundUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, uniqueMemberIds));

      if (foundUsers.length !== uniqueMemberIds.length) {
        throw new HttpError(400, "One or more users do not exist");
      }
    }

    const [actorUser] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);

    const actorName = actorUser?.displayName || "Someone";

    const { newChat, allMembers } = await db.transaction(async (tx) => {
      // 1. Create chats record
      const [chat] = await tx
        .insert(chats)
        .values({
          type: "group",
          name: input.name,
          createdBy: actorId,
          lastSeq: 0,
        })
        .returning();

      // 2. Add creator as owner
      await tx.insert(chatMembers).values({
        chatId: chat.id,
        userId: actorId,
        role: "owner",
        firstVisibleSeq: 0,
      });

      // 3. Add other members
      if (uniqueMemberIds.length > 0) {
        await tx.insert(chatMembers).values(
          uniqueMemberIds.map((userId) => ({
            chatId: chat.id,
            userId,
            role: "member" as ChatRole,
            firstVisibleSeq: 0,
            addedBy: actorId,
          }))
        );
      }

      // 4. Create system message
      await createSystemMessage(
        tx,
        chat.id,
        actorId,
        {
          action: "group_created",
          actorId,
          targetIds: uniqueMemberIds,
        },
        `${actorName} created group "${input.name}"`
      );

      return { newChat: chat, allMembers: [actorId, ...uniqueMemberIds] };
    });

    // Realtime events after transaction commit
    const realtime = getRealtimeManager();
    if (realtime) {
      allMembers.forEach((userId) => {
        realtime.joinChatRoom(userId, newChat.id);
        realtime.emitToUser(userId, "chat:added", { chatId: newChat.id });
      });
      realtime.emitToChat(newChat.id, "group:updated", {
        chatId: newChat.id,
        name: newChat.name!,
      });
    }

    return {
      id: newChat.id,
      name: newChat.name,
      type: "group",
      role: "owner" as ChatRole,
      memberCount: totalMembers,
      createdAt: newChat.createdAt,
    };
  }

  // Lists all members of a group with display names and roles (excluding emails)
  async getMembers(actorId: string, chatId: string) {
    await requirePermission(chatId, actorId, "group:view");

    const memberRows = await db
      .select({
        userId: chatMembers.userId,
        displayName: users.displayName,
        role: chatMembers.role,
        joinedAt: chatMembers.joinedAt,
      })
      .from(chatMembers)
      .innerJoin(users, eq(chatMembers.userId, users.id))
      .where(eq(chatMembers.chatId, chatId))
      .orderBy(chatMembers.joinedAt);

    return memberRows;
  }

  // Updates the display name of a group chat
  async renameGroup(actorId: string, chatId: string, newName: string) {
    await requirePermission(chatId, actorId, "group:rename");

    const [actorUser] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);

    const actorName = actorUser?.displayName || "Someone";

    await db.transaction(async (tx) => {
      await tx
        .update(chats)
        .set({
          name: newName,
          updatedAt: new Date(),
        })
        .where(eq(chats.id, chatId));

      await createSystemMessage(
        tx,
        chatId,
        actorId,
        {
          action: "renamed",
          actorId,
          newName,
        },
        `${actorName} renamed group to "${newName}"`
      );
    });

    const realtime = getRealtimeManager();
    if (realtime) {
      realtime.emitToChat(chatId, "group:updated", {
        chatId,
        name: newName,
      });
    }

    return { chatId, name: newName };
  }

  // Adds new members to an existing group, locking the chat row to enforce size limits
  async addMembers(actorId: string, chatId: string, input: AddGroupMembersInput) {
    await requirePermission(chatId, actorId, "group:add_member");

    const uniqueUserIds = Array.from(new Set(input.userIds));

    // Validate users exist
    const foundUsers = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, uniqueUserIds));

    if (foundUsers.length !== uniqueUserIds.length) {
      throw new HttpError(400, "One or more users do not exist");
    }

    const [actorUser] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);

    const actorName = actorUser?.displayName || "Someone";

    const { newlyAddedUsers } = await db.transaction(async (tx) => {
      // Lock the chat row to prevent concurrent limit-exceeding additions
      const [lockedChat] = await tx
        .select()
        .from(chats)
        .where(eq(chats.id, chatId))
        .for("update");

      if (!lockedChat) {
        throw new HttpError(404, "Chat not found");
      }

      const existingMembers = await tx
        .select({ userId: chatMembers.userId })
        .from(chatMembers)
        .where(eq(chatMembers.chatId, chatId));

      const existingIds = new Set(existingMembers.map((m) => m.userId));
      const candidates = uniqueUserIds.filter((uid) => !existingIds.has(uid));

      if (existingMembers.length + candidates.length > env.MAX_GROUP_MEMBERS) {
        throw new HttpError(
          400,
          `Cannot add members: would exceed maximum group capacity of ${env.MAX_GROUP_MEMBERS}`
        );
      }

      if (candidates.length === 0) {
        return { newlyAddedUsers: [] };
      }

      // Set firstVisibleSeq to chats.lastSeq + 1 so newly added members cannot read prior history
      const firstVisibleSeq = lockedChat.lastSeq + 1;

      await tx.insert(chatMembers).values(
        candidates.map((userId) => ({
          chatId,
          userId,
          role: "member" as ChatRole,
          firstVisibleSeq,
          addedBy: actorId,
        }))
      );

      const addedDisplayNames = foundUsers
        .filter((u) => candidates.includes(u.id))
        .map((u) => u.displayName)
        .join(", ");

      await createSystemMessage(
        tx,
        chatId,
        actorId,
        {
          action: "member_added",
          actorId,
          targetIds: candidates,
        },
        `${actorName} added ${addedDisplayNames}`
      );

      return { newlyAddedUsers: candidates };
    });

    const realtime = getRealtimeManager();
    if (realtime && newlyAddedUsers.length > 0) {
      const addedDetails = foundUsers
        .filter((u) => newlyAddedUsers.includes(u.id))
        .map((u) => ({
          userId: u.id,
          displayName: u.displayName,
          role: "member" as ChatRole,
        }));

      newlyAddedUsers.forEach((uid) => {
        realtime.joinChatRoom(uid, chatId);
        realtime.emitToUser(uid, "chat:added", { chatId });
      });

      realtime.emitToChat(chatId, "group:member_added", {
        chatId,
        members: addedDetails,
      });
    }

    return {
      success: true,
      addedCount: newlyAddedUsers.length,
    };
  }

  // Removes a target member or handles a user leaving the group
  async removeMember(actorId: string, chatId: string, targetUserId: string) {
    const isLeaving = actorId === targetUserId;

    const [actorUser] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);

    const actorName = actorUser?.displayName || "Someone";

    if (isLeaving) {
      // User is leaving
      const { member } = await requireMember(chatId, actorId);
      if (member.role === "owner") {
        throw new HttpError(400, "Transfer ownership first");
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(chatMembers)
          .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, actorId)));

        await createSystemMessage(
          tx,
          chatId,
          actorId,
          {
            action: "member_left",
            actorId,
          },
          `${actorName} left the group`
        );
      });

      const realtime = getRealtimeManager();
      if (realtime) {
        realtime.emitToUser(actorId, "chat:removed", { chatId });
        realtime.leaveChatRoom(actorId, chatId);
        realtime.emitToChat(chatId, "group:member_removed", {
          chatId,
          userId: actorId,
          reason: "left",
        });
      }

      return { success: true, message: "Left group successfully" };
    } else {
      // User is removing someone else
      const { member: actorMember } = await requirePermission(
        chatId,
        actorId,
        "group:remove_member"
      );

      const targetMember = await getMembership(chatId, targetUserId);
      if (!targetMember) {
        throw new HttpError(404, "Target user is not a member of the group");
      }

      if (!canRemoveTarget(actorMember.role, targetMember.role)) {
        throw new HttpError(
          403,
          "Forbidden: you do not have permission to remove this member"
        );
      }

      const [targetUser] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);

      const targetName = targetUser?.displayName || "Someone";

      await db.transaction(async (tx) => {
        await tx
          .delete(chatMembers)
          .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, targetUserId)));

        await createSystemMessage(
          tx,
          chatId,
          actorId,
          {
            action: "member_removed",
            actorId,
            targetIds: [targetUserId],
          },
          `${actorName} removed ${targetName}`
        );
      });

      const realtime = getRealtimeManager();
      if (realtime) {
        realtime.emitToUser(targetUserId, "chat:removed", { chatId });
        realtime.leaveChatRoom(targetUserId, chatId);
        realtime.emitToChat(chatId, "group:member_removed", {
          chatId,
          userId: targetUserId,
          reason: "removed",
        });
      }

      return { success: true, message: "Member removed successfully" };
    }
  }

  // Changes role of a member (promotes to admin or demotes to member) - Owner only
  async changeRole(
    actorId: string,
    chatId: string,
    targetUserId: string,
    newRole: "admin" | "member"
  ) {
    await requirePermission(chatId, actorId, "group:change_role");

    if (actorId === targetUserId) {
      throw new HttpError(400, "Cannot change your own role through this action");
    }

    const targetMember = await getMembership(chatId, targetUserId);
    if (!targetMember) {
      throw new HttpError(404, "Target user is not a member of the group");
    }

    const [actorUser] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);

    const [targetUser] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    const actorName = actorUser?.displayName || "Owner";
    const targetName = targetUser?.displayName || "Member";

    await db.transaction(async (tx) => {
      await tx
        .update(chatMembers)
        .set({ role: newRole })
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, targetUserId)));

      await createSystemMessage(
        tx,
        chatId,
        actorId,
        {
          action: "role_changed",
          actorId,
          targetIds: [targetUserId],
          newRole,
        },
        `${actorName} changed ${targetName}'s role to ${newRole}`
      );
    });

    const realtime = getRealtimeManager();
    if (realtime) {
      realtime.emitToChat(chatId, "group:role_changed", {
        chatId,
        userId: targetUserId,
        role: newRole,
      });
    }

    return { success: true, userId: targetUserId, role: newRole };
  }

  // Transfers group ownership to an existing member (old owner becomes admin)
  async transferOwnership(actorId: string, chatId: string, newOwnerId: string) {
    await requirePermission(chatId, actorId, "group:transfer_owner");

    if (actorId === newOwnerId) {
      throw new HttpError(400, "You are already the owner of this group");
    }

    const targetMember = await getMembership(chatId, newOwnerId);
    if (!targetMember) {
      throw new HttpError(400, "Target is not a member of the group");
    }

    const [actorUser] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);

    const [targetUser] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, newOwnerId))
      .limit(1);

    const actorName = actorUser?.displayName || "Owner";
    const targetName = targetUser?.displayName || "Member";

    await db.transaction(async (tx) => {
      // Due to partial unique index chat_members_one_owner_idx, demote first then promote
      await tx
        .update(chatMembers)
        .set({ role: "admin" })
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, actorId)));

      await tx
        .update(chatMembers)
        .set({ role: "owner" })
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, newOwnerId)));

      await createSystemMessage(
        tx,
        chatId,
        actorId,
        {
          action: "ownership_transferred",
          actorId,
          targetIds: [newOwnerId],
        },
        `${actorName} transferred group ownership to ${targetName}`
      );
    });

    const realtime = getRealtimeManager();
    if (realtime) {
      realtime.emitToChat(chatId, "group:role_changed", {
        chatId,
        userId: actorId,
        role: "admin",
      });
      realtime.emitToChat(chatId, "group:role_changed", {
        chatId,
        userId: newOwnerId,
        role: "owner",
      });
    }

    return { success: true, newOwnerId };
  }

  // Deletes an entire group chat (owner only)
  async deleteGroup(actorId: string, chatId: string) {
    await requirePermission(chatId, actorId, "group:delete");

    await db.transaction(async (tx) => {
      await tx.delete(chats).where(eq(chats.id, chatId));
    });

    const realtime = getRealtimeManager();
    if (realtime) {
      realtime.emitToChat(chatId, "group:deleted", { chatId });
    }

    return { success: true, message: "Group deleted successfully" };
  }
}

export const groupService = new GroupService();

