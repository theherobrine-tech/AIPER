const express = require('express');
const router = express.Router();
const TestInstance = require('../../models/TestInstance');
const Job = require('../../models/Job');
const ParameterGroup = require('../../models/ParameterGroup');
const Parameter = require('../../models/Parameter');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const { createNotification, notifyAdminOfficers } = require('../../utils/notifier');
const { audit } = require('../../utils/auditLogger');

// Get instances based on role
router.get('/instances', protect, async (req, res) => {
  try {
    let query = {};

    if (req.user.role === 'HEAD') {
      // HEAD sees: instances they created, excluding REOPENED and CANCELLED
      query = { createdBy: req.user._id, status: { $nin: ['REOPENED', 'CANCELLED'] } };
    } else if (req.user.role === 'ADMIN_OFFICER') {
      // ADMIN_OFFICER sees all instances
      query = {};
    } else if (req.user.role === 'ASSISTANT') {
      // ASSISTANT sees: only their PENDING tasks
      query = { assignedTo: req.user._id, status: 'PENDING' };
    }
    // ADMIN sees all (no filter)

    let instances = await TestInstance.find(query)
      .populate('assignedTo', 'name')
      .populate('createdBy', 'name department')
      .populate('reviewHistory.by', 'name')
      .sort({ deadline: 1 });

    // Helper: attach sampleDescription from related Jobs AND filter out ON_HOLD jobs
    const attachSampleDescriptionsAndFilterHold = async (docs) => {
      const jobIds = [...new Set(docs.map(i => i.jobId?.toString()))].filter(Boolean);
      const jobs = await Job.find({ _id: { $in: jobIds } }, 'sample.sample_description status');
      const jobMap = {};
      jobs.forEach(j => { jobMap[j._id.toString()] = j; });

      return docs
        .filter(doc => {
          const parentJob = jobMap[doc.jobId?.toString()];
          return parentJob && parentJob.status !== 'ON_HOLD';
        })
        .map(doc => ({
          ...doc,
          sampleDescription: jobMap[doc.jobId?.toString()]?.sample?.sample_description || ''
        }));
    };

    // Mask client name and attach sample description for ASSISTANT
    if (req.user.role === 'ASSISTANT') {
      let docs = instances.map(i => { let d = i.toObject(); d.clientName = '***HIDDEN***'; return d; });
      docs = await attachSampleDescriptionsAndFilterHold(docs);
      instances = docs;
    }

    // Attach sample description for HEAD (shown read-only in review card)
    if (req.user.role === 'HEAD') {
      let docs = instances.map(i => i.toObject());
      docs = await attachSampleDescriptionsAndFilterHold(docs);
      instances = docs;
    }

    res.json(instances);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching instances' });
  }
});

// Head dispatches tests to assistants
router.post('/instances', protect, authorize('HEAD'), async (req, res) => {
  try {
    const { jobId, deadline, assignments, blueprintId, bulkDispatch } = req.body;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    const dept = req.user.department ? req.user.department.toLowerCase() : 'micro';
    const clientName = (job.customer && job.customer.customer_name) || job.clientName || '';

    // Child test code convention:
    //   Micro dept  → {jobCode}-1   e.g. 2605070001-1
    //   Chemical/Chemical dept → {jobCode}-2   e.g. 2605070001-2
    const deptSuffix = (dept === 'micro') ? '1' : '2';
    const baseTestCode = `${job.jobCode}-${deptSuffix}`;

    // Group assignments by assignedTo (assistant ID)
    const assistantMap = {};
    if (assignments && Array.isArray(assignments)) {
      // Bulk-fetch live specifications from Parameter collection (Data Settings source of truth).
      // This ensures analysts always see the current spec even if Data Settings were updated
      // after the job was created (job.parameters[].specification may be stale).
      const nonPanelIds = assignments
        .filter(a => !a.isPanel && a.parameterId)
        .map(a => a.parameterId);
      const liveParams = await Parameter.find(
        { _id: { $in: nonPanelIds } },
        'specification'
      );
      const liveSpecMap = {};
      liveParams.forEach(p => { liveSpecMap[p._id.toString()] = p.specification || ''; });

      for (const assignment of assignments) {
        const astId = assignment.assignedTo;
        if (!assistantMap[astId]) {
          assistantMap[astId] = [];
        }

        if (assignment.isPanel) {
          // Fetch the parameters for the specific sub-panel (GCMSMS or LCMSMS)
          const group = await ParameterGroup.findOne({ isPesticidePanel: true, pesticidePanelType: 'food' }).populate('pesticideSubPanels.parameters.parameterId');
          if (group) {
            const panel = group.pesticideSubPanels.find(p => p.panelName === assignment.panelName);
            if (panel) {
              for (const param of panel.parameters) {
                // Ensure no duplicate params just in case
                if (!assistantMap[astId].some(existing => String(existing.parameterId) === String(param.parameterId._id))) {
                  assistantMap[astId].push({
                    parameterId: param.parameterId._id,
                    name: param.name,
                    value: '',
                    unit: 'mg/kg',
                    specification: param.specification || '',
                    isPanel: true,
                    panelName: assignment.panelName
                  });
                }
              }
            }
          }
        } else {
          // Use live spec from Parameter (Data Settings). Fall back to job-time value if
          // the Parameter document was somehow not found.
          const liveSpec = liveSpecMap[String(assignment.parameterId)];
          assistantMap[astId].push({
            parameterId: assignment.parameterId,
            name: assignment.name,
            value: '',
            unit: assignment.unit,
            specification: liveSpec !== undefined ? liveSpec : (assignment.specification || '')
          });
        }
      }
    }

    // Before processing individual analysts, fetch ALL HELD instances for this department.
    // This allows us to rescue data for parameters that the Head might be reassigning
    // from Analyst A to Analyst B after an unhold.
    const allHeldInstances = await TestInstance.find({
      jobId,
      department: dept,
      status: 'HELD'
    }).sort({ _id: -1 });

    const savedDataMap = {};
    for (const inst of allHeldInstances) {
      for (const r of inst.results) {
        if (r.isSaved || (r.value && r.value.trim() !== '')) {
          const paramId = String(r.parameterId);
          // allHeldInstances is sorted by _id descending (newest first).
          // We only take the value if we haven't already found a newer one.
          if (!savedDataMap[paramId]) {
            savedDataMap[paramId] = r.toObject ? r.toObject() : r;
          }
        }
      }
    }

    const createdInstances = [];
    const assistantIds = Object.keys(assistantMap);

    for (let i = 0; i < assistantIds.length; i++) {
      const astId = assistantIds[i];
      const rawParams = assistantMap[astId];

      // Merge rescued data into the freshly assigned parameters
      const params = rawParams.map(p => {
        const saved = savedDataMap[String(p.parameterId)];
        if (saved) {
          return {
            ...p,
            value: saved.value || p.value,
            testMethod: saved.testMethod || p.testMethod,
            isSaved: saved.isSaved || false
          };
        }
        return p;
      });

      // If multiple assistants under the same department, differentiate with a letter suffix
      // e.g. 2605070001-1a, 2605070001-1b
      const suffix = assistantIds.length > 1
        ? `${baseTestCode}${String.fromCharCode(97 + i)}` // a, b, c…
        : baseTestCode;

      let testCode = suffix;
      let heldInstance = null;
      
      const isReopen = Boolean(job.distribution[dept] && job.distribution[dept].reopenInfo);

      if (!isReopen) {
        // Try to recycle the exact testCode document (e.g., from a previous hold/cancel cycle)
        // This prevents generating -v2 suffixes when reassigning cross-analyst.
        heldInstance = await TestInstance.findOne({ testCode: suffix, jobId });
      }

      if (heldInstance && ['HELD', 'CANCELLED'].includes(heldInstance.status)) {
        // We can safely resurrect this document without generating a new testCode
        testCode = suffix;
      } else {
        // We cannot resurrect (either it's a reopen, or the exact suffix is currently COMPLETED/PENDING)
        // We must create a new one, ensuring uniqueness by adding -vX if necessary
        heldInstance = null; // Clear it so we drop into TestInstance.create
        const existingCount = await TestInstance.countDocuments({ testCode: { $regex: `^${suffix.replace(/-/g, '\\-')}` } });
        if (existingCount > 0) {
          testCode = `${suffix}-v${existingCount + 1}`;
        }
      }

      let instance;

      if (heldInstance) {
        // We strictly set results to the newly merged `params`.
        // This ensures any parameters the Head removed from this analyst are dropped,
        // and newly assigned parameters are included, while preserving saved data.
        heldInstance.results = params;
        heldInstance.status = 'PENDING';
        heldInstance.deadline = deadline;
        heldInstance.assignedTo = astId;
        if (bulkDispatch) heldInstance.bulkDispatch = bulkDispatch;

        // Clear stale state from the previous cycle — the job went through a full
        // flow reset when held/unheld, so old reassignment history, retest constraints,
        // and comparison snapshots are no longer relevant.
        heldInstance.reviewHistory = [];
        heldInstance.retestOnly = [];
        heldInstance.previousResults = [];
        heldInstance.completedAt = null;

        await heldInstance.save();
        instance = heldInstance;

        // Notify Assistant
        await createNotification({
          recipient: astId,
          type: 'ACTION_REQUIRED',
          title: 'Test Re-assigned',
          message: `Your task ${heldInstance.testCode} for job ${job.jobCode} has been re-assigned to you after being on hold.`,
          relatedJobId: jobId,
          relatedInstanceId: instance._id,
          link: '/assistant'
        });
      } else {
        instance = await TestInstance.create({
          jobId,
          testCode,
          clientName,
          deadline,
          department: dept,
          assignedTo: astId,
          results: params,
          createdBy: req.user._id,
          ...(bulkDispatch ? { bulkDispatch } : {}),
          ...(job.distribution[dept] && job.distribution[dept].reopenInfo && job.distribution[dept].reopenInfo.parentInstanceId ? {
            version: (job.distribution[dept].reopenInfo.parentVersion || 0) + 1,
            parentInstanceId: job.distribution[dept].reopenInfo.parentInstanceId
          } : {})
        });

        // Notify Assistant
        await createNotification({
          recipient: astId,
          type: 'ACTION_REQUIRED',
          title: 'New Test Assigned',
          message: `You have been assigned test ${testCode} for job ${job.jobCode}.`,
          relatedJobId: jobId,
          relatedInstanceId: instance._id,
          link: '/assistant'
        });
      }

      createdInstances.push(instance);
    }

    // Clean up any HELD instances in this department that were NOT resurrected
    // (e.g. an analyst who was assigned previously but received no parameters in this dispatch)
    const resurrectedIds = createdInstances.map(i => i._id.toString());
    const obsoleteInstances = allHeldInstances.filter(i => !resurrectedIds.includes(i._id.toString()));
    
    for (const obs of obsoleteInstances) {
      await TestInstance.updateOne({ _id: obs._id }, { $set: { status: 'CANCELLED' } });
    }

    // Update job distribution status
    const distDept = (dept === 'chemical') ? 'chemical' : 'micro';
    if (job.distribution && job.distribution[distDept]) {
      job.distribution[distDept].status = 'ASSIGNED_TO_ASSISTANT';
      job.distribution[distDept].reopenInfo = undefined;
      await job.save();
    }

    // Notify Admin Officers
    await notifyAdminOfficers({
      type: 'INFO',
      title: 'Job Dispatched',
      message: `${dept.toUpperCase()} HEAD has dispatched tests for job ${job.jobCode} to analysts.`,
      relatedJobId: jobId
    });

    if (req.app.get('io')) {
      req.app.get('io').emit('JOB_DISTRIBUTED');
    }

    audit('TEST_DISPATCHED', {
      req,
      message: `${dept.toUpperCase()} HEAD dispatched ${createdInstances.length} test(s) for job ${job.jobCode}`,
      target: { model: 'Job', documentId: jobId, identifier: job.jobCode }
    });

    if (bulkDispatch?.bulkId) {
      let assignedAnalystName = 'an analyst';
      if (assistantIds.length > 0) {
        const analystUser = await User.findById(assistantIds[0]);
        if (analystUser) assignedAnalystName = analystUser.name;
      }
      audit('BULK_DISPATCHED', {
        req,
        message: `BULK dispatch — ${dept.toUpperCase()} HEAD dispatched ${bulkDispatch.totalJobsInBatch} jobs to analyst ${assignedAnalystName} (bulkId: ${bulkDispatch.bulkId}). Jobs: ${bulkDispatch.jobCodes.join(', ')}`,
        target: { model: 'Job', documentId: jobId, identifier: job.jobCode }
      });
    }

    res.status(201).json({ message: 'Dispatched successfully', instances: createdInstances });
  } catch (err) {
    res.status(500).json({ message: 'Error creating instance', error: err.message });
  }
});

module.exports = router;
