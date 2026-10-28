// src/modules/group/group.routes.ts
// REST API endpoints for group chat creation, member management, and role administration.

import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { authenticate } from "../../plugins/authenticate";
import { groupService } from "./group.service";
import {
  createGroupSchema,
  updateGroupNameSchema,
  addGroupMembersSchema,
  updateMemberRoleSchema,
  transferOwnershipSchema,
  chatIdParamSchema,
  memberParamSchema,
} from "./group.schemas";

export const groupRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /groups - Create a new group chat
  app.post(
    "/groups",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const input = createGroupSchema.parse(request.body);
      const group = await groupService.createGroup(request.user.sub, input);
      return reply.status(201).send(group);
    }
  );

  // GET /groups/:chatId - Retrieve group members list
  app.get(
    "/groups/:chatId",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { chatId } = chatIdParamSchema.parse(request.params);
      const members = await groupService.getMembers(request.user.sub, chatId);
      return reply.status(200).send(members);
    }
  );

  // PATCH /groups/:chatId - Rename group
  app.patch(
    "/groups/:chatId",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { chatId } = chatIdParamSchema.parse(request.params);
      const { name } = updateGroupNameSchema.parse(request.body);
      const result = await groupService.renameGroup(request.user.sub, chatId, name);
      return reply.status(200).send(result);
    }
  );

  // POST /groups/:chatId/members - Add members to group
  app.post(
    "/groups/:chatId/members",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { chatId } = chatIdParamSchema.parse(request.params);
      const input = addGroupMembersSchema.parse(request.body);
      const result = await groupService.addMembers(request.user.sub, chatId, input);
      return reply.status(200).send(result);
    }
  );

  // DELETE /groups/:chatId/members/:userId - Remove member or leave group
  app.delete(
    "/groups/:chatId/members/:userId",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { chatId, userId } = memberParamSchema.parse(request.params);
      const result = await groupService.removeMember(request.user.sub, chatId, userId);
      return reply.status(200).send(result);
    }
  );

  // PATCH /groups/:chatId/members/:userId - Change member role (admin or member)
  app.patch(
    "/groups/:chatId/members/:userId",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { chatId, userId } = memberParamSchema.parse(request.params);
      const { role } = updateMemberRoleSchema.parse(request.body);
      const result = await groupService.changeRole(
        request.user.sub,
        chatId,
        userId,
        role
      );
      return reply.status(200).send(result);
    }
  );

  // POST /groups/:chatId/transfer-ownership - Transfer group ownership
  app.post(
    "/groups/:chatId/transfer-ownership",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { chatId } = chatIdParamSchema.parse(request.params);
      const { userId } = transferOwnershipSchema.parse(request.body);
      const result = await groupService.transferOwnership(
        request.user.sub,
        chatId,
        userId
      );
      return reply.status(200).send(result);
    }
  );

  // DELETE /groups/:chatId - Delete entire group (owner only)
  app.delete(
    "/groups/:chatId",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { chatId } = chatIdParamSchema.parse(request.params);
      const result = await groupService.deleteGroup(request.user.sub, chatId);
      return reply.status(200).send(result);
    }
  );
};

