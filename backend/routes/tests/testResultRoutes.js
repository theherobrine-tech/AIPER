const express = require('express');
const router = express.Router();
const TestInstance = require('../../models/TestInstance');
const Job = require('../../models/Job');
const Notification = require('../../models/Notification');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const { createNotification, notifyAdminOfficers, notifyAdmins } = require('../../utils/notifier');
const { audit } = require('../../utils/auditLogger');
const { attemptUlrAssignment } = require('../../utils/ulrService');

// ASSISTANT saves partial progress
router.put('/instances/:id/save-progress', protect, authorize('ASSISTANT'), async (req, res) => {
  try {
    const { results, testingPeriod } = req.body;
    const instance = await TestInstance.findOne({ _id: req.params.id, assignedTo: req.user._id });

    if (!instance) return res.status(404).json({ message: 'Test not found or not assigned to you' });
    if (instance.status !== 'PENDING') return res.status(400).json({ message: 'Test is not in a submittable state' });

    instance.results = results;
    if (testingPeriod) {
      instance.testingPeriod = {
        startDate: testingPeriod.startDate || null,
        endDate: testingPeriod.endDate || null
      };
    }
    await instance.save();

    res.json(instance);
  } catch (err) {
    res.status(500).json({ message: 'Error saving progress' });
  }
});

// ASSISTANT fills in results and submits for HEAD review
router.put('/instances/:id/results', protect, authorize('ASSISTANT'), async (req, res) => {
  try {
    const { results, testingPeriod } = req.body;
    const instance = await TestInstance.findOne({ _id: req.params.id, assignedTo: req.user._id });

    if (!instance) return res.status(404).json({ message: 'Test not found or not assigned to you' });
    if (instance.status !== 'PENDING') return res.status(400).json({ message: 'Test is not in a submittable state' });

    instance.results = results;
    if (testingPeriod) {
      instance.testingPeriod = {
        startDate: testingPeriod.startDate || null,
        endDate: testingPeriod.endDate || null
      };
    }
    // Move to HEAD review — NOT completed yet
    instance.status = 'PENDING_HEAD_REVIEW';
    // Clear previousResults since this is a fresh submission
    instance.previousResults = [];

    await instance.save();

    // Delete the 'New Test Assigned' or 'Job Reassigned' notification for the assistant
    await Notification.deleteMany({
      recipient: req.user._id,
      relatedInstanceId: instance._id,
      $or: [{ title: 'New Test Assigned' }, { title: 'Job Reassigned' }]
    });

    // Notify HEAD for review
    await createNotification({
      recipient: instance.createdBy,
      type: 'ACTION_REQUIRED',
      title: 'Review Required',
      message: `Analyst has submitted results for test ${instance.testCode}. Pending your review.`,
      relatedJobId: instance.jobId,
      relatedInstanceId: instance._id,
      link: '/head/review'
    });

    if (req.app.get('io')) {
      req.app.get('io').emit('TEST_SUBMITTED');
    }

    audit('TEST_RESULTS_SUBMITTED', {
      req,
      message: `Results submitted for test ${instance.testCode}`,
      target: { model: 'TestInstance', documentId: instance._id.toString(), identifier: instance.testCode }
    });

    res.json(instance);
  } catch (err) {
    res.status(500).json({ message: 'Error updating results' });
  }
});

// HEAD reviews an instance: APPROVE (→ COMPLETED) or REASSIGN (→ PENDING)
router.put('/instances/:id/review', protect, authorize('HEAD'), async (req, res) => {
  try {
    const { action, note, selectedParams } = req.body;
    // selectedParams: [{ parameterId, assignedTo }] — only for REASSIGN with selective params
    if (!['APPROVE', 'REASSIGN'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action. Must be APPROVE or REASSIGN.' });
    }

    const instance = await TestInstance.findOne({ _id: req.params.id, createdBy: req.user._id });
    if (!instance) return res.status(404).json({ message: 'Instance not found or not yours to review' });
    if (instance.status !== 'PENDING_HEAD_REVIEW') {
      return res.status(400).json({ message: 'Instance is not awaiting HEAD review' });
    }

    // Log this review action
    instance.reviewHistory.push({
      action,
      by: req.user._id,
      role: 'HEAD',
      note: note || ''
    });

    if (action === 'APPROVE') {
      instance.status = 'COMPLETED';
      instance.completedAt = new Date();
      instance.retestOnly = []; // clear any previous retest flags
      await instance.save();

      // Now update job distribution status to COMPLETED
      const job = await Job.findById(instance.jobId);
      if (job) {
        // Find all instances for this job (this now sees the saved COMPLETED status)
        const allInstances = await TestInstance.find({ jobId: instance.jobId }).populate('createdBy', 'department');
        
        // Helper to check if all instances created by a specific department are completed
        const isDeptCompleted = (deptName) => {
          const deptInstances = allInstances.filter(i => i.createdBy?.department?.toLowerCase() === deptName.toLowerCase());
          if (deptInstances.length === 0) return false;
          return deptInstances.every(i => i.status === 'COMPLETED');
        };

        if (job.distribution.micro.required && isDeptCompleted('micro')) {
          job.distribution.micro.status = 'COMPLETED';
        }
        if (job.distribution.chemical.required && (isDeptCompleted('chemical'))) {
          job.distribution.chemical.status = 'COMPLETED';
        }
        
        // Deferred ULR assignment via isolated service.
        // Handles both NABL (auto-assign) and Non-NABL opt-in (reserved slot).
        await attemptUlrAssignment(job, req.user);

        await job.save({ validateBeforeSave: false });

      }

      await notifyAdminOfficers({
        type: 'SUCCESS',
        title: 'Report Generated',
        message: `Department Head has approved test ${instance.testCode}. Report generated.`,
        relatedJobId: instance.jobId,
        relatedInstanceId: instance._id,
        link: '/admin-officer/audit'
      });
      
      await notifyAdmins({
        type: 'SUCCESS',
        title: 'Report Generated',
        message: `Test ${instance.testCode} has been finalized by Department Head.`,
        relatedJobId: instance.jobId,
        relatedInstanceId: instance._id
      });
    } else {
      // REASSIGN flow
      instance.previousResults = instance.results.map(r => ({ ...r.toObject() }));

      if (selectedParams && selectedParams.length > 0) {
        // ── Selective reassignment ──
        const selectedParamIds = selectedParams.map(sp => sp.parameterId);
        
        // Group selected params by target analyst
        const byAnalyst = {};
        for (const sp of selectedParams) {
          const targetId = sp.assignedTo || instance.assignedTo.toString();
          if (!byAnalyst[targetId]) byAnalyst[targetId] = [];
          byAnalyst[targetId].push(sp.parameterId);
        }

        const originalAssigneeId = instance.assignedTo.toString();
        const uniqueAnalysts = Object.keys(byAnalyst);

        // Check if all selected params go to the original analyst (simple case)
        if (uniqueAnalysts.length === 1 && uniqueAnalysts[0] === originalAssigneeId) {
          // Simple case: same analyst, just mark retestOnly and wipe selected param values
          instance.retestOnly = selectedParamIds;
          instance.results = instance.results.map(r => {
            const obj = r.toObject ? r.toObject() : r;
            if (selectedParamIds.includes(obj.parameterId.toString())) {
              return { ...obj, isSaved: false };
            }
            return obj; // keep approved values intact
          });
          instance.status = 'PENDING';
          await instance.save();

          await createNotification({
            recipient: instance.assignedTo,
            type: 'WARNING',
            title: 'Partial Retest Required',
            message: `${selectedParamIds.length} parameter(s) in test ${instance.testCode} need retesting.`,
            relatedJobId: instance.jobId,
            relatedInstanceId: instance._id,
            link: '/assistant'
          });
        } else {
          // Complex case: multiple analysts
          // The original instance keeps the params assigned to the original analyst (if any)
          const originalAnalystParams = byAnalyst[originalAssigneeId] || [];
          
          if (originalAnalystParams.length > 0) {
            // Original analyst retests some params
            instance.retestOnly = originalAnalystParams;
            // REMOVE params going to other analysts from results entirely (don't wipe in-place).
            // Wiping leaves them in the array — frontend shows non-retestOnly params as 'Approved',
            // and HEAD's review card shows an empty row for them. Filtering is the correct fix.
            instance.results = instance.results
              .filter(r => {
                const obj = r.toObject ? r.toObject() : r;
                const paramId = obj.parameterId.toString();
                // Keep only: params going back to original analyst OR params not selected at all
                if (selectedParamIds.includes(paramId) && !originalAnalystParams.includes(paramId)) {
                  return false; // going to another analyst — remove entirely
                }
                return true;
              })
              .map(r => {
                const obj = r.toObject ? r.toObject() : r;
                if (originalAnalystParams.includes(obj.parameterId.toString())) {
                  // Param stays with original analyst — reset isSaved for retest
                  return { ...obj, isSaved: false };
                }
                return obj; // not selected for reassign — keep approved values intact
              });
            instance.status = 'PENDING';
            await instance.save();

            await createNotification({
              recipient: instance.assignedTo,
              type: 'WARNING',
              title: 'Partial Retest Required',
              message: `${originalAnalystParams.length} parameter(s) in test ${instance.testCode} need retesting.`,
              relatedJobId: instance.jobId,
              relatedInstanceId: instance._id,
              link: '/assistant'
            });
          } else {
            // Original analyst has no params to retest—remove reassigned params from their results
            // so the HEAD's review card shows only the remaining (non-reassigned) params.
            instance.retestOnly = [];
            instance.results = instance.results.filter(r => {
              const obj = r.toObject ? r.toObject() : r;
              return !selectedParamIds.includes(obj.parameterId.toString());
            });

            if (instance.results.length === 0) {
              // All of A's params were sent to other analysts—nothing left for HEAD to review on this instance.
              // Auto-approve: mark COMPLETED so it doesn’t block the job's completion check.
              instance.status = 'COMPLETED';
              instance.completedAt = new Date();
            }
            // If results remain, keep PENDING_HEAD_REVIEW so HEAD sees the card
            // with only the surviving params and can explicitly approve them.
            await instance.save();
          }

          // Create or update instances for other analysts
          for (const [analystId, paramIds] of Object.entries(byAnalyst)) {
            if (analystId === originalAssigneeId) continue; // already handled above

            // Build wiped results for these params (from previousResults snapshot)
            const analystResults = instance.previousResults
              .filter(r => paramIds.includes(r.parameterId.toString()))
              .map(r => {
                const obj = r.toObject ? r.toObject() : r;
                return {
                  ...obj,
                  value: '',
                  testMethod: '',
                  isSaved: false,
                  assignedTo: analystId
                };
              });

            // ── Check if this analyst already has an active instance for this job ──
            const existingInstance = await TestInstance.findOne({
              jobId: instance.jobId,
              assignedTo: analystId,
              status: { $in: ['PENDING', 'PENDING_HEAD_REVIEW'] }
            });

            if (existingInstance) {
              // ── Merge: inject new params into the existing instance ──
              const existingParamIds = new Set(existingInstance.results.map(r => r.parameterId.toString()));

              // Add new params to results if not already present
              for (const result of analystResults) {
                if (!existingParamIds.has(result.parameterId.toString())) {
                  existingInstance.results.push(result);
                }
              }

              // retestOnly logic — add new params to retestOnly when:
              //   (a) B already submitted (PENDING_HEAD_REVIEW): existing submitted work stays Approved,
              //       only new params need re-doing.
              //   (b) B is a sub-instance from a prior split (retestOnly is already non-empty):
              //       the existing retestOnly already scopes which params are editable;
              //       new params must be added to retestOnly or they'll falsely show as Approved.
              // If B is a fresh PENDING instance with retestOnly=[], leave it untouched so
              //   all params (old + new) remain editable — adding retestOnly would wrongly
              //   mark B's own unsaved params as Approved.
              if (existingInstance.status === 'PENDING_HEAD_REVIEW' || existingInstance.retestOnly.length > 0) {
                const existingRetestIds = new Set(existingInstance.retestOnly.map(id => id.toString()));
                for (const paramId of paramIds) {
                  if (!existingRetestIds.has(paramId.toString())) {
                    existingInstance.retestOnly.push(paramId);
                  }
                }
              }

              // Pull back to PENDING (B must save the new params before submitting again)
              existingInstance.status = 'PENDING';

              existingInstance.reviewHistory.push({
                action: 'REASSIGN_MERGED',
                by: req.user._id,
                role: 'HEAD',
                note: `${paramIds.length} param(s) merged in from ${instance.testCode} by HEAD reassign`
              });

              await existingInstance.save();

              await createNotification({
                recipient: analystId,
                type: 'WARNING',
                title: 'Additional Params Assigned',
                message: `${paramIds.length} additional parameter(s) have been added to your existing test for job ${instance.testCode.split('-')[0]}.`,
                relatedJobId: instance.jobId,
                relatedInstanceId: existingInstance._id,
                link: '/assistant'
              });
            } else {
              // ── No existing instance — create a new sub-instance as before ──
              const subInstance = new TestInstance({
                jobId: instance.jobId,
                testCode: `${instance.testCode}-R${Date.now().toString(36).slice(-4)}`,
                clientName: instance.clientName,
                deadline: instance.deadline,
                assignedTo: analystId,
                status: 'PENDING',
                results: analystResults,
                retestOnly: paramIds,
                reviewHistory: [],
                createdBy: req.user._id,
                version: instance.version,
                parentInstanceId: instance._id
              });
              await subInstance.save();

              await createNotification({
                recipient: analystId,
                type: 'WARNING',
                title: 'Retest Assigned',
                message: `You have been assigned ${paramIds.length} parameter(s) for retest on ${instance.testCode}.`,
                relatedJobId: instance.jobId,
                relatedInstanceId: subInstance._id,
                link: '/assistant'
              });
            }
          }
        }
      } else {
        // ── Legacy: full reassignment (preserve values) ──
        instance.retestOnly = [];
        instance.results = instance.results.map(r => {
          const obj = r.toObject ? r.toObject() : r;
          return {
            ...obj,
            isSaved: false
          };
        });
        instance.status = 'PENDING';
        await instance.save();

        await createNotification({
          recipient: instance.assignedTo,
          type: 'WARNING',
          title: 'Job Reassigned',
          message: `Your results for test ${instance.testCode} were rejected by HEAD. Please revise.`,
          relatedJobId: instance.jobId,
          relatedInstanceId: instance._id,
          link: '/assistant'
        });
      }

      await notifyAdminOfficers({
        type: 'INFO',
        title: 'Job Reassigned by HEAD',
        message: `HEAD rejected results for test ${instance.testCode} and sent it back for retesting.`,
        relatedJobId: instance.jobId,
        relatedInstanceId: instance._id
      });
    }

    if (req.app.get('io')) {
      req.app.get('io').emit('TEST_REVIEWED');
    }

    audit('TEST_REVIEWED', {
      req,
      message: `Test ${instance.testCode} ${action === 'approve' ? 'approved' : 'reassigned'} by HEAD`,
      target: { model: 'TestInstance', documentId: instance._id.toString(), identifier: instance.testCode }
    });

    res.json(instance);
  } catch (err) {
    console.error('Error processing review:', err);
    res.status(500).json({ message: 'Error processing review', error: err.message });
  }
});



// ADMIN_OFFICER reopens a completed instance
router.post('/instances/:id/reopen', protect, authorize('ADMIN_OFFICER'), async (req, res) => {
  try {
    const { reopenNote, assignedHeadId } = req.body;
    if (!reopenNote) return res.status(400).json({ message: 'Reopen note is required' });

    const instance = await TestInstance.findById(req.params.id);
    if (!instance) return res.status(404).json({ message: 'Instance not found' });
    if (instance.status !== 'COMPLETED') {
      return res.status(400).json({ message: 'Only completed instances can be reopened' });
    }

    // Mark old instance as REOPENED
    instance.status = 'REOPENED';
    instance.reopenNote = reopenNote;
    instance.reopenedBy = req.user._id;
    await instance.save();

    // Reset Job distribution status to PENDING and store reopenInfo
    const job = await Job.findById(instance.jobId);
    if (job) {
      // Determine which department this instance belongs to
      const dept = ['micro', 'chemical'].find(d => {
        return job.distribution[d]?.required &&
          String(job.distribution[d]?.assignedTo) === String(instance.createdBy);
      });

      if (dept) {
        job.distribution[dept].status = 'PENDING';
        job.distribution[dept].reopenInfo = {
          parentInstanceId: instance._id,
          parentVersion: instance.version,
          note: reopenNote
        };
        // Optionally change the assigned HEAD
        if (assignedHeadId) {
          job.distribution[dept].assignedTo = assignedHeadId;
        }
        await job.save();
      }
    }

    res.json({ message: 'Job reopened successfully', reopenedInstance: instance });
  } catch (err) {
    res.status(500).json({ message: 'Error reopening instance', error: err.message });
  }
});

// Get version history for an instance (walk the parentInstanceId chain)
router.get('/instances/:id/history', protect, async (req, res) => {
  try {
    const versions = [];
    let currentId = req.params.id;

    // Start from the requested instance and walk backwards
    while (currentId) {
      const inst = await TestInstance.findById(currentId)
        .populate('blueprintId', 'name')
        .populate('assignedTo', 'name')
        .populate('createdBy', 'name department')
        .populate('reviewHistory.by', 'name')
        .populate('reopenedBy', 'name');
      if (!inst) break;
      versions.push(inst);
      currentId = inst.parentInstanceId;
    }

    // Also check if there are newer versions pointing to this instance
    let newerVersionId = req.params.id;
    while (true) {
      const newer = await TestInstance.findOne({ parentInstanceId: newerVersionId })
        .populate('blueprintId', 'name')
        .populate('assignedTo', 'name')
        .populate('createdBy', 'name department')
        .populate('reviewHistory.by', 'name')
        .populate('reopenedBy', 'name');
      if (!newer) break;
      versions.unshift(newer); // Add newer versions at the front
      newerVersionId = newer._id;
    }

    // Sort by version descending (newest first)
    versions.sort((a, b) => b.version - a.version);

    res.json(versions);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching version history', error: err.message });
  }
});

module.exports = router;
