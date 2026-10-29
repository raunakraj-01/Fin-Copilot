import { Router } from 'express';
import { asyncRoute, validate } from '../utils/http.js';
import { answerChat, chatInput } from '../services/ai/copilot.js';

const router = Router({ mergeParams: true });
router.post('/chat', asyncRoute(async (req, res) => {
  const input = validate(chatInput, req.body);
  const result = await answerChat(req.params.workspaceId, input);
  if (!result) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  res.write(`event: tool\ndata: ${JSON.stringify({ status: 'complete', tool: result.tool })}\n\n`);
  res.write(`event: answer\ndata: ${JSON.stringify(result)}\n\n`);
  res.end();
}));
export default router;
