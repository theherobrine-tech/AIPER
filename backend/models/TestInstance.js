const mongoose = require('mongoose');

const resultParameterSchema = new mongoose.Schema({
  parameterId: { type: String, required: true },
  name: { type: String }, // copied from blueprint
  value: { type: String }, // filled by assistant
  unit: { type: String },
  isSaved: { type: Boolean, default: false },
  testMethod: { type: String, default: '' }, // test standard / method used by analyst
  specification: { type: String, default: '' },
  isPanel: { type: Boolean, default: false },
  panelName: { type: String, default: '' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null } // per-parameter analyst override for selective reassignment
});

const reviewEntrySchema = new mongoose.Schema({
  action: { type: String, enum: ['APPROVE', 'REASSIGN', 'REASSIGN_MERGED'], required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  role: { type: String }, // 'HEAD' or 'ADMIN_OFFICER'
  note: { type: String },
  date: { type: Date, default: Date.now }
});

const testInstanceSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' }, // Link to Admin Officer created Job
  // Removed blueprintId dependency
  testCode: { type: String, required: true, unique: true }, // e.g. #UL-782X
  clientName: { type: String },
  deadline: { type: Date, required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: {
    type: String,
    enum: ['PENDING', 'PENDING_HEAD_REVIEW', 'COMPLETED', 'REOPENED', 'CANCELLED', 'HELD'],
    default: 'PENDING'
  },
  department: { type: String, enum: ['micro', 'chemical'], default: null }, // which dept this belongs to
  results: [resultParameterSchema],
  previousResults: [resultParameterSchema], // snapshot of last submission for reference on reassignment
  retestOnly: [{ type: String }], // parameter IDs that need retesting (empty = all need testing)
  reviewHistory: [reviewEntrySchema],        // full audit trail of approvals/rejections
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  completedAt: { type: Date },
  testingPeriod: {
    startDate: { type: Date },
    endDate: { type: Date }
  },

  // Future-proofing for job reopening: when a completed job is reopened,
  // a new TestInstance is created with version+1 and parentInstanceId pointing
  // to the previous completed instance. The old instance stays intact.
  version: { type: Number, default: 1 },
  parentInstanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'TestInstance', default: null },
  reopenNote: { type: String },      // reason for reopening (set on the old instance)
  reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  bulkDispatch: {
    bulkId: { type: String, default: null },
    dispatchedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    dispatchedAt: { type: Date, default: null },
    totalJobsInBatch: { type: Number, default: null },
    jobCodes: { type: [String], default: [] }
  }
}, { timestamps: true });

module.exports = mongoose.model('TestInstance', testInstanceSchema);
