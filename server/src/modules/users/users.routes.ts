import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { storeFile } from '../../lib/storage';
import { requireAuth } from '../../middleware/auth';
import { ApiError } from '../../middleware/error';
import { validate } from '../../middleware/validate';
import { publicUser } from '../auth/auth.service';

export const usersRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const updateProfileSchema = z.object({
  fullName: z.string().min(2).max(80).optional(),
  phone: z.string().regex(/^[0-9+\-\s]{8,15}$/).nullable().optional(),
});

usersRouter.patch('/me', requireAuth, validate(updateProfileSchema), async (req, res, next) => {
  try {
    const user = await prisma.user.update({ where: { id: req.user!.id }, data: req.body });
    res.json({ user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

usersRouter.post('/me/avatar', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, 'FILE_REQUIRED', 'Attach an image file');
    if (!req.file.mimetype.startsWith('image/')) throw new ApiError(415, 'BAD_TYPE', 'Avatar must be an image');
    const url = await storeFile(req.file.buffer, req.file.mimetype, `avatars/${req.user!.id}`);
    const user = await prisma.user.update({ where: { id: req.user!.id }, data: { avatarUrl: url } });
    res.json({ user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});
