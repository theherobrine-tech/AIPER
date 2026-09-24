const express = require('express');
const router = express.Router();
const Job = require('../../models/Job');
const TestInstance = require('../../models/TestInstance');
const SampleTransfer = require('../../models/SampleTransfer');
const User = require('../../models/User');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const { createNotification, notifyAdminOfficers, notifyAdmins } = require('../../utils/notifier');
const { audit } = require('../../utils/auditLogger');

// Return Job to Officer (HEAD only)
// PUT — Head approves the job during joint review
router.put('/:id/approve-review', protect, authorize('HEAD'), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    const dept = req.user.department ? req.user.department.toLowerCase() : '';
    const myDept = (dept === 'chemical') ? 'chemical' : 'micro';
    const otherDept = myDept === 'micro' ? 'chemical' : 'micro';

    if (!job.distribution[myDept] || job.distribution[myDept].status !== 'PENDING_REVIEW') {
      return res.status(400).json({ message: 'Job is not pending your review' });
    }

    job.headApproval[myDept] = true;
    job.distribution[myDept].status = 'REVIEW_APPROVED';

    // CHECK UNLOCK (universal for single and multi-dept)
    const isMultiDept = job.distribution.micro.required && job.distribution.chemical.required;
    const otherApproved = job.headApproval[otherDept] === true || !job.distribution[otherDept].required;

    // If all required departments for THIS job have approved:
    if (otherApproved) {
      if (job.distribution.micro.required) job.distribution.micro.status = 'PENDING';
      if (job.distribution.chemical.required) job.distribution.chemical.status = 'PENDING';
      
      if (!isMultiDept) {
        job.sampleTransferState = 'NOT_REQUIRED';
      } else if (!job.siblingJobId) {
        job.sampleTransferState = 'PENDING_TRANSFER';
      } else {
        // Hybrid sync logic: Transfer unlock requires ALL siblings to be fully approved
        const sibling = await Job.findById(job.siblingJobId);
        if (sibling) {
          const siblingFullyApproved = (!sibling.distribution.micro.required || sibling.headApproval.micro === true) &&
                                       (!sibling.distribution.chemical.required || sibling.headApproval.chemical === true);
          
          if (siblingFullyApproved) {
            job.sampleTransferState = 'PENDING_TRANSFER';
            // Unlock sibling if it was also waiting AND is also multi-dept
            const siblingIsMultiDept = sibling.distribution.micro.required && sibling.distribution.chemical.required;
            if (siblingIsMultiDept && (sibling.distribution.micro.status === 'PENDING' || sibling.distribution.chemical.status === 'PENDING')) {
              sibling.sampleTransferState = 'PENDING_TRANSFER';
              await sibling.save();
            }
          } else {
            // Sibling not ready yet, keep this one waiting
            job.sampleTransferState = 'PENDING_APPROVAL';
          }
        } else {
          job.sampleTransferState = 'PENDING_TRANSFER'; // fallback if no sibling found
        }
      }
    }

    job.history.push({
      action: 'REVIEW_APPROVED',
      by: req.user._id,
      note: `${myDept.toUpperCase()} HEAD approved job details.`
    });

    await job.save();

    audit('JOB_REVIEW_APPROVED', {
      req,
      message: `${myDept.toUpperCase()} HEAD approved job ${job.jobCode}`,
      target: { model: 'Job', documentId: job._id.toString(), identifier: job.jobCode }
    });

    if (req.app.get('io')) {
      req.app.get('io').emit('JOB_UPDATED');
    }

    res.json(job);
  } catch (error) {
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
});

router.post('/:id/return', protect, authorize('HEAD'), async (req, res) => {
  try {
    const { department, note } = req.body; // 'micro' or 'chemical'
    if (!department || !note) {
      return res.status(400).json({ message: 'Department and note are required' });
    }

    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    if (!job.distribution[department]) {
      return res.status(400).json({ message: 'Invalid department' });
    }

    if (!['PENDING', 'PENDING_REVIEW', 'REVIEW_APPROVED'].includes(job.distribution[department].status)) {
      return res.status(400).json({ message: 'Job cannot be returned at this stage' });
    }

    job.distribution[department].status = 'RETURNED';

    // Reset approval tracking and transfer state
    job.headApproval = { micro: false, chemical: false };
    job.sampleTransferState = 'NOT_REQUIRED';

    // If it's a multi-department job in the joint review phase, force both to RETURNED
    if (job.distribution.micro.required && job.distribution.chemical.required) {
      if (['PENDING_REVIEW', 'REVIEW_APPROVED', 'RETURNED'].includes(job.distribution.micro.status) ||
        ['PENDING_REVIEW', 'REVIEW_APPROVED', 'RETURNED'].includes(job.distribution.chemical.status)) {
        job.distribution.micro.status = 'RETURNED';
        job.distribution.chemical.status = 'RETURNED';
      }
    }

    job.history.push({
      action: 'RETURNED_TO_OFFICER',
      by: req.user._id,
      note: note
    });

    await job.save();

    audit('JOB_RETURNED', {
      req,
      message: `Job ${job.jobCode} returned by ${department.toUpperCase()} HEAD — reason: ${note}`,
      target: { model: 'Job', documentId: job._id.toString(), identifier: job.jobCode }
    });

    // Notification to Admin Officer
    await notifyAdminOfficers({
      type: 'WARNING',
      title: 'Job Returned',
      message: `Job ${job.jobCode} was returned by ${department.toUpperCase()} HEAD. Reason: ${note}`,
      relatedJobId: job._id,
      link: '/admin-officer/jobs'
    });

    if (req.app.get('io')) {
      req.app.get('io').emit('JOB_RETURNED');
      req.app.get('io').emit('JOB_UPDATED');
    }

    res.json({ message: 'Job returned successfully', job });
  } catch (error) {
    res.status(500).json({ message: 'Error returning job', error: error.message });
  }
});

// Spawn a Child Retest Job (ADMIN_OFFICER only)
router.post('/:id/retest', protect, authorize('ADMIN_OFFICER'), async (req, res) => {
  try {
    const parentJob = await Job.findById(req.params.id);
    if (!parentJob) return res.status(404).json({ message: 'Job not found' });

    const rootJobId = parentJob.isRetest ? parentJob.parentJobId : parentJob._id;
    if (!rootJobId) {
      console.error('RETEST ERROR: Missing rootJobId for parentJob', parentJob._id);
      return res.status(400).json({ message: 'Invalid job lineage: Missing parent ID' });
    }
    const rootJob = await Job.findById(rootJobId);
    if (!rootJob) {
      console.error('RETEST ERROR: Root job not found for ID', rootJobId);
      return res.status(404).json({ message: 'Root job not found for this retest' });
    }

    const retestCount = await Job.countDocuments({ parentJobId: rootJobId });
    const retestNumber = retestCount + 1;
    const jobCode = `${rootJob.jobCode}-retest-${retestNumber}`;

    const { customer, sample, compliance, parameters, groupMetadata, pesticidePanel, reopenReason } = req.body;

    if (!parameters || (!Array.isArray(parameters) && !pesticidePanel?.enabled)) {
      return res.status(400).json({ message: 'Parameters or Pesticide Panel are required for retest' });
    }

    const hasMicro = parameters && parameters.some(p => p.type && p.type.toLowerCase() === 'micro');
    const hasChemical = (parameters && parameters.some(p => p.type && p.type.toLowerCase() !== 'micro')) || pesticidePanel?.enabled;

    const job = new Job({
      jobCode,
      sampleSerial: rootJob.sampleSerial,
      clientName: customer?.customer_name || 'N/A',
      totalSampleVolume: parseFloat(sample.sample_quantity) || 0,
      customer,
      sample,
      compliance,
      parameters: parameters || [],
      groupMetadata,
      pesticidePanel, distribution: {
        micro: { required: hasMicro, status: 'PENDING' },
        chemical: { required: hasChemical, status: 'PENDING' }
      },
      createdBy: req.user._id,
      isRetest: true,
      parentJobId: rootJobId,
      reopenReason: reopenReason,
      retestNumber: retestNumber
    });

    await job.save();

    // Mark parent job's completed instances as REOPENED to trigger timeline UI changes
    await TestInstance.updateMany(
      { jobId: parentJob._id, status: 'COMPLETED' },
      { $set: { status: 'REOPENED', reopenNote: reopenReason, reopenedBy: req.user._id } }
    );

    // Notifications
    if (hasMicro) {
      const microHeads = await User.find({ role: 'HEAD', department: { $regex: /^micro/i } });
      for (const head of microHeads) {
        await createNotification({ recipient: head._id, type: 'ACTION_REQUIRED', title: 'Retest Available', message: `Job ${jobCode} requires MICRO retest.`, relatedJobId: job._id, link: '/head/dispatcher' });
      }
    }
    if (hasChemical) {
      const chemicalHeads = await User.find({ role: 'HEAD', department: { $regex: /^(chemical|chemical)$/i } });
      for (const head of chemicalHeads) {
        await createNotification({ recipient: head._id, type: 'ACTION_REQUIRED', title: 'Retest Available', message: `Job ${jobCode} requires CHEMICAL retest.`, relatedJobId: job._id, link: '/head/dispatcher' });
      }
    }

    if (req.app.get('io')) {
      req.app.get('io').emit('JOB_RETEST_INITIATED');
    }

    res.status(201).json(job);
  } catch (error) {
    console.error('RETEST ERROR:', error);
    res.status(500).json({
      message: 'Error creating retest job',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Place a job on hold
router.put('/:id/hold', protect, authorize('ADMIN_OFFICER', 'ADMIN'), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    
    if (job.status === 'CANCELLED') {
      return res.status(400).json({ message: 'Cannot hold a cancelled job.' });
    }
    if (job.status === 'ON_HOLD') {
      return res.status(400).json({ message: 'Job is already on hold.' });
    }

    const { holdReason } = req.body;
    if (!holdReason || holdReason.trim().length === 0) {
      return res.status(400).json({ message: 'A hold reason is required.' });
    }

    job.status = 'ON_HOLD';
    job.holdReason = holdReason;
    job.heldAt = new Date();
    job.heldBy = req.user._id;

    job.history.push({
      action: 'HELD',
      by: req.user._id,
      note: `Job placed on hold: ${holdReason}`
    });

    // Clear ULR slot reservation if any
    if (job.reservedUlrSlot) {
      job.reservedUlrSlot = null;
      job.reservedUlrYear = null;
    }

    await job.save();

    // Sibling hold logic
    if (job.siblingJobId) {
      const sibling = await Job.findById(job.siblingJobId);
      if (sibling && sibling.status !== 'ON_HOLD' && sibling.status !== 'CANCELLED') {
        sibling.status = 'ON_HOLD';
        sibling.holdReason = holdReason;
        sibling.heldAt = new Date();
        sibling.heldBy = req.user._id;
        
        sibling.history.push({
          action: 'HELD',
          by: req.user._id,
          note: `Job placed on hold: ${holdReason} (Synced from sibling job)`
        });
        
        if (sibling.reservedUlrSlot) {
          sibling.reservedUlrSlot = null;
          sibling.reservedUlrYear = null;
        }
        
        await sibling.save();
        
        audit('JOB_HELD', {
          req,
          message: `Job ${sibling.jobCode} placed on hold (sync)`,
          target: { model: 'Job', documentId: sibling._id.toString(), identifier: sibling.jobCode }
        });
        
        if (req.app.get('io')) {
          req.app.get('io').emit('JOB_HELD', { jobId: sibling._id });
        }
      }
    }

    audit('JOB_HELD', {
      req,
      message: `Job ${job.jobCode} placed on hold`,
      target: { model: 'Job', documentId: job._id.toString(), identifier: job.jobCode }
    });

    if (req.app.get('io')) {
      req.app.get('io').emit('JOB_HELD', { jobId: job._id });
    }

    res.json({ message: 'Job successfully placed on hold', job });
  } catch (error) {
    res.status(500).json({ message: 'Error holding job', error: error.message });
  }
});

// Cancel a job (Soft Delete)
router.put('/:id/cancel', protect, authorize('ADMIN_OFFICER', 'ADMIN'), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (job.status === 'CANCELLED') {
      return res.status(400).json({ message: 'Job is already cancelled' });
    }

    job.status = 'CANCELLED';
    job.cancelledAt = new Date();
    job.cancelledBy = req.user._id;
    job.history.push({
      action: 'UPDATED',
      by: req.user._id,
      note: 'Job was cancelled.'
    });

    await job.save();

    audit('JOB_CANCELLED', {
      req,
      message: `Job ${job.jobCode} cancelled`,
      target: { model: 'Job', documentId: job._id.toString(), identifier: job.jobCode }
    });

    // Cascade cancellation to any generated tasks or transfers
    await TestInstance.updateMany({ jobId: job._id }, { status: 'CANCELLED' });
    await SampleTransfer.updateMany({ jobId: job._id }, { status: 'CANCELLED' });

    // If it has a sibling job (hybrid), cancel it too to keep them in sync
    if (job.siblingJobId) {
      const sibling = await Job.findById(job.siblingJobId);
      if (sibling && sibling.status !== 'CANCELLED') {
        sibling.status = 'CANCELLED';
        sibling.cancelledAt = new Date();
        sibling.cancelledBy = req.user._id;
        sibling.history.push({
          action: 'UPDATED',
          by: req.user._id,
          note: 'Sibling job was cancelled.'
        });
        await sibling.save();

        audit('JOB_CANCELLED', {
          req,
          message: `Sibling job ${sibling.jobCode} auto-cancelled`,
          target: { model: 'Job', documentId: sibling._id.toString(), identifier: sibling.jobCode }
        });
        
        await TestInstance.updateMany({ jobId: sibling._id }, { status: 'CANCELLED' });
        await SampleTransfer.updateMany({ jobId: sibling._id }, { status: 'CANCELLED' });
      }
    }

    if (req.app.get('io')) {
      req.app.get('io').emit('JOB_CANCELLED');
      req.app.get('io').emit('JOB_UPDATED');
    }

    res.json({ message: 'Job successfully cancelled', job });
  } catch (error) {
    res.status(500).json({ message: 'Error cancelling job', error: error.message });
  }
});

module.exports = router;
