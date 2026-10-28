// src/modules/files/files.routes.ts
// Direct R2 upload initialization, completion, and authenticated file download/preview endpoints.

import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { authenticate } from "../../plugins/authenticate";
import { filesService } from "./files.service";
import {
  fileInitSchema,
  fileCompleteSchema,
  fileIdParamSchema,
} from "./files.schemas";

export const filesRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /files/init - Initiate direct client-to-R2 upload (rate-limited)
  app.post(
    "/files/init",
    {
      preHandler: [authenticate],
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const input = fileInitSchema.parse(request.body);
      const result = await filesService.initUpload(request.user.sub, input);
      return reply.status(200).send(result);
    }
  );

  // POST /files/complete - Finalize upload and enqueue file for worker processing
  app.post(
    "/files/complete",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const input = fileCompleteSchema.parse(request.body);
      const result = await filesService.completeUpload(request.user.sub, input);
      return reply.status(200).send(result);
    }
  );

  // GET /files/:fileId - Retrieve file status and metadata
  app.get(
    "/files/:fileId",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { fileId } = fileIdParamSchema.parse(request.params);
      const result = await filesService.getFileStatus(request.user.sub, fileId);
      return reply.status(200).send(result);
    }
  );

  // GET /files/:fileId/download - Get signed ~5 min download URL with attachment header
  app.get(
    "/files/:fileId/download",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { fileId } = fileIdParamSchema.parse(request.params);
      const result = await filesService.getDownloadUrl(request.user.sub, fileId);
      return reply.status(200).send(result);
    }
  );

  // GET /files/:fileId/preview - Get signed ~5 min preview URL (inline PDF, MP4, or image)
  app.get(
    "/files/:fileId/preview",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { fileId } = fileIdParamSchema.parse(request.params);
      const result = await filesService.getPreviewUrl(request.user.sub, fileId);
      return reply.status(200).send(result);
    }
  );

  // GET /files/:fileId/thumbnail - Get signed ~5 min thumbnail URL
  app.get(
    "/files/:fileId/thumbnail",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { fileId } = fileIdParamSchema.parse(request.params);
      const result = await filesService.getThumbnailUrl(request.user.sub, fileId);
      return reply.status(200).send(result);
    }
  );
};

