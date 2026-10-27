import { Router } from 'express';
import { asyncRoute, validate, workspaceOr404 } from '../utils/http.js';
import { workspaceCreate, workspacePatch } from '../validators/finance.js';
import Workspace from '../models/Workspace.js';

const router = Router();
const shape = workspace => ({ id: String(workspace._id), name: workspace.name, asOfDate: workspace.asOfDate,
  openingCashPaise: workspace.openingCashPaise, minimumReservePaise: workspace.minimumReservePaise });

router.post('/', asyncRoute(async (req, res) => {
  const workspace = await Workspace.create(validate(workspaceCreate, req.body));
  res.status(201).json({ workspace: shape(workspace) });
}));
router.get('/:workspaceId', asyncRoute(async (req, res) => {
  res.json({ workspace: shape(await workspaceOr404(req.params.workspaceId)) });
}));
router.patch('/:workspaceId', asyncRoute(async (req, res) => {
  const workspace = await workspaceOr404(req.params.workspaceId);
  Object.assign(workspace, validate(workspacePatch, req.body));
  await workspace.save();
  res.json({ workspace: shape(workspace) });
}));

export default router;
