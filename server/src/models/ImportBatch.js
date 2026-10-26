import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  fileName: String, fileType: { type: String, enum: ['csv', 'xlsx'] },
  kind: { type: String, enum: ['receivables', 'payables'], required: true },
  sourceSystem: { type: String, enum: ['csv', 'excel', 'tally_export'], required: true },
  status: { type: String, enum: ['inspected', 'validated', 'committed', 'failed'], default: 'inspected' },
  headers: [String], rawRows: [mongoose.Schema.Types.Mixed], mapping: mongoose.Schema.Types.Mixed,
  previewRows: [mongoose.Schema.Types.Mixed], rowIssues: [mongoose.Schema.Types.Mixed],
  counts: { accepted: Number, needsReview: Number, rejected: Number, committed: Number },
}, { timestamps: true });
schema.index({ workspaceId: 1, createdAt: -1 });

export default mongoose.model('ImportBatch', schema);
