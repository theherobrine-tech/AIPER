const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const { protect, adminOrHead } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const Job = require('../models/Job');
const TestInstance = require('../models/TestInstance');
const { generateReport } = require('../services/reportGenerator');
const { uploadCustomReport, downloadCustomReport, deleteCustomReport, getReportStatus } = require('../services/reportStorage');
const { audit } = require('../utils/auditLogger');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for .docx
});

/**
 * Helper to fetch a fully populated job
 */
const getPopulatedJob = async (jobId) => {
  return await Job.findById(jobId)
    .populate('createdBy', 'name email role')
    .populate('distribution.micro.assignedHead', 'name')
    .populate('distribution.chemical.assignedHead', 'name')
    .populate('parameters.parameterId', 'name type unit');
};

const attachResultsToJob = async (job) => {
  const jobObj = job.toObject();
  // Only pull results from active instances — REOPENED/CANCELLED are frozen snapshots
  const instances = await TestInstance.find({
    jobId: job._id,
    status: { $in: ['PENDING', 'PENDING_HEAD_REVIEW', 'COMPLETED'] }
  }).sort({ version: -1 });
  
  // Create a map of parameterId -> result for quick lookup
  const resultMap = {};
  instances.forEach(inst => {
    inst.results.forEach(r => {
      const pid = r.parameterId.toString();
      // Only store the first (latest version) result per parameter
      if (!resultMap[pid]) {
        resultMap[pid] = {
          value: r.value,
          testMethod: r.testMethod,
          specification: r.specification,
          unit: r.unit
        };
      }
    });
  });

  const mergeResults = (params) => {
    if (!params) return [];
    return params.map(p => {
      const pId = p.parameterId ? p.parameterId._id.toString() : null;
      const resData = pId ? resultMap[pId] : null;
      return {
        ...p,
        value: resData?.value || '',
        testMethod: resData?.testMethod || '',
        specification: p.specification || resData?.specification || '',
        unit: resData?.unit || p.unit // analyst override takes priority, fallback to job parameter default
      };
    });
  };

  jobObj.parameters = mergeResults(jobObj.parameters);

  // NOTE: We intentionally do NOT append orphaned TestInstance results here.
  // job.parameters is the single source of truth for which parameters appear
  // in the report. If a parameter was removed via modification, its orphaned
  // result in the TestInstance is excluded by design.

  // Merge testingPeriod from TestInstances (earliest start, latest end)
  let mergedStart = null;
  let mergedEnd = null;
  let latestCompletedAt = null;
  for (const inst of instances) {
    if (inst.testingPeriod?.startDate) {
      const s = new Date(inst.testingPeriod.startDate);
      if (!mergedStart || s < mergedStart) mergedStart = s;
    }
    if (inst.testingPeriod?.endDate) {
      const e = new Date(inst.testingPeriod.endDate);
      if (!mergedEnd || e > mergedEnd) mergedEnd = e;
    }
    if (inst.completedAt) {
      const c = new Date(inst.completedAt);
      if (!latestCompletedAt || c > latestCompletedAt) latestCompletedAt = c;
    }
  }
  if (mergedStart || mergedEnd) {
    jobObj.testingPeriod = { startDate: mergedStart, endDate: mergedEnd };
  }
  if (latestCompletedAt && !jobObj.completedAt) {
    jobObj.completedAt = latestCompletedAt;
  }

  return jobObj;
};

/**
 * @desc Get the report (Custom if exists, else Auto-generated)
 * @route GET /api/export/report/:jobId
 * @query type - 'nabl' or 'non_nabl'
 */
router.get('/report/:jobId', protect, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { type = 'non_nabl' } = req.query;

    let job = await getPopulatedJob(jobId);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    job = await attachResultsToJob(job);

    // 1. Check for custom report in GridFS
    const customReport = await downloadCustomReport(jobId, type);

    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    if (customReport) {
      // Stream custom report
      const filename = `Report_${job.jobCode}_${type}_Custom.docx`;
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      return customReport.stream.pipe(res);
    }

    // 2. Fallback to generating on the fly
    const buffer = await generateReport(job, type);
    const filename = `Report_${job.jobCode}_${type}.docx`;
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

  } catch (error) {
    console.error('Error serving DOCX report:', error);
    res.status(500).json({ message: 'Failed to serve report', error: error.message });
  }
});

/**
 * @desc Upload a custom .docx report
 * @route POST /api/export/report/:jobId/upload
 * @query type - 'nabl' or 'non_nabl'
 */
router.post('/report/:jobId/upload', protect, upload.single('reportDoc'), async (req, res) => {
  try {
    const { jobId } = req.params;
    const { type = 'non_nabl' } = req.query;

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Must be .docx
    if (req.file.mimetype !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return res.status(400).json({ message: 'Only .docx files are allowed' });
    }

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    // Optional: we can delete the old custom one to save space
    await deleteCustomReport(jobId, type);

    const filename = `Custom_${job.jobCode}_${type}.docx`;
    const metadata = {
      jobId,
      reportType: type,
      uploadedBy: {
        id: req.user._id,
        name: req.user.name,
        role: req.user.role
      }
    };

    const fileId = await uploadCustomReport(req.file.buffer, filename, metadata);

    // Log to job history
    await Job.findByIdAndUpdate(jobId, {
      $push: {
        history: {
          action: 'REPORT_UPLOADED',
          by: req.user._id,
          note: `Custom ${type} report uploaded`,
          timestamp: new Date()
        }
      }
    });
    if (job) {
      audit('REPORT_UPLOADED', {
        req,
        message: `Custom ${type} report uploaded for job ${job.jobCode}`,
        target: { model: 'Job', documentId: job._id.toString(), identifier: job.jobCode }
      });
    }

    res.json({ message: 'Custom report uploaded successfully', fileId });
  } catch (error) {
    console.error('Error uploading custom report:', error);
    res.status(500).json({ message: 'Failed to upload report', error: error.message });
  }
});

/**
 * @desc Revert to auto-generated report (Delete custom)
 * @route POST /api/export/report/:jobId/revert
 * @query type - 'nabl' or 'non_nabl'
 */
router.post('/report/:jobId/revert', protect, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { type = 'non_nabl' } = req.query;

    await deleteCustomReport(jobId, type);

    // Log to job history
    await Job.findByIdAndUpdate(jobId, {
      $push: {
        history: {
          action: 'REPORT_REVERTED',
          by: req.user._id,
          note: `Reverted ${type} report to auto-generated`,
          timestamp: new Date()
        }
      }
    });
    const job = await Job.findById(jobId);
    if (job) {
      audit('REPORT_REVERTED', {
        req,
        message: `Reverted to auto-generated ${type} report for job ${job.jobCode}`,
        target: { model: 'Job', documentId: job._id.toString(), identifier: job.jobCode }
      });
    }

    res.json({ message: 'Reverted to auto-generated report successfully' });
  } catch (error) {
    console.error('Error reverting report:', error);
    res.status(500).json({ message: 'Failed to revert report', error: error.message });
  }
});

/**
 * @desc Get the status of the report (Custom or Auto)
 * @route GET /api/export/report/:jobId/status
 * @query type - 'nabl' or 'non_nabl'
 */
router.get('/report/:jobId/status', protect, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { type = 'non_nabl' } = req.query;

    const status = await getReportStatus(jobId, type);
    res.json(status);
  } catch (error) {
    console.error('Error fetching report status:', error);
    res.status(500).json({ message: 'Failed to fetch report status', error: error.message });
  }
});


/**
 * @desc    Export full database backup as JSON
 * @route   GET /api/export/db-backup
 * @access  Admin, Admin Officer, Head
 * @returns Single JSON file: { collectionName: [documents...] }
 */
router.get('/db-backup', protect, authorize('ADMIN', 'ADMIN_OFFICER', 'HEAD'), async (req, res) => {
  try {
    const db = mongoose.connection.db;

    // Enumerate all collections
    const collectionInfos = await db.listCollections().toArray();

    const backup = {};
    for (const info of collectionInfos) {
      const name = info.name;
      backup[name] = await db.collection(name).find({}).toArray();
    }

    // Build filename: FTL_LIMS_DD-MM-YYYY_ssmmHH.json
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const filename = `FTL_LIMS_${dd}-${mm}-${yyyy}_${ss}${min}${hh}.json`;

    res.set('Content-Type', 'application/json');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    // Use EJSON to correctly serialize ObjectIds, Dates, etc. (mirrors bson.json_util.dumps)
    res.send(EJSON.stringify(backup, null, 2));
  } catch (error) {
    console.error('Error generating DB backup:', error);
    res.status(500).json({ message: 'Failed to generate backup', error: error.message });
  }
});

module.exports = router;
