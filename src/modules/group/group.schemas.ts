// src/modules/group/group.schemas.ts
// Request validation schemas for group chat management and member role transitions.

import { z } from "zod";

export const createGroupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Group name cannot be empty")
    .max(100, "Group name cannot exceed 100 characters"),
  memberIds: z.array(z.string().uuid("Invalid user ID")).max(255).default([]),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Group name cannot be empty")
    .max(100, "Group name cannot exceed 100 characters"),
});
export type UpdateGroupNameInput = z.infer<typeof updateGroupNameSchema>;

export const addGroupMembersSchema = z.object({
  userIds: z
    .array(z.string().uuid("Invalid user ID"))
    .min(1, "At least one member ID is required")
    .max(255),
});
export type AddGroupMembersInput = z.infer<typeof addGroupMembersSchema>;

export const updateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"], {
    errorMap: () => ({ message: "Role must be either 'admin' or 'member'" }),
  }),
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export const transferOwnershipSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
});
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;

export const chatIdParamSchema = z.object({
  chatId: z.string().uuid("Invalid chat ID"),
});
export type ChatIdParam = z.infer<typeof chatIdParamSchema>;

export const memberParamSchema = z.object({
  chatId: z.string().uuid("Invalid chat ID"),
  userId: z.string().uuid("Invalid user ID"),
});
export type MemberParam = z.infer<typeof memberParamSchema>;

