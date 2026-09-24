import React, { useState, useEffect, useContext } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchWithCache, invalidateCache, CACHE_KEYS, isCached } from "../../utils/cache";
import { cacheGet, cacheSet } from "../../utils/cacheStorage";
import API_URL from "../../utils/api";
import Spinner from "../../components/Spinner";

import {
  AlertTriangle, Play, Plus, Check, Clock, Edit, FileText, XCircle, Search, LogOut, ChevronDown,
  ChevronRight, ArrowLeft, Download, Eye, LayoutDashboard, Users, Activity as ActivityIcon, RefreshCw, X, Shield, CheckCircle,
  ClipboardCheck, Lock, RotateCcw } from "lucide-react";
import TransferManagement from "./TransferManagement";
import { useSocket } from "../../context/SocketContext";
import { AuthContext } from "../../context/AuthContext";
import { formatJobCode } from "../../utils/serialUtils";
import { formatDate } from "../../utils/dateUtils";
import InfiniteScroll from "../../components/InfiniteScroll";
import JobDetailsModal from "../../components/JobDetailsModal";

const isOverdue = (deadlineStr) => {
  if (!deadlineStr) return false;
  return new Date(deadlineStr) < new Date();
};

export default function Dispatcher() {
  const [assistants, setAssistants] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [hasMoreJobs, setHasMoreJobs] = useState(false);
  const [jobsCursor, setJobsCursor] = useState(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const { user } = useContext(AuthContext);

  const [expandedJobId, setExpandedJobId] = useState(null);
  const [deadlineDates, setDeadlineDates] = useState({}); // jobId -> date string
  const [deadlineTimes, setDeadlineTimes] = useState({}); // jobId -> time string
  const [assignments, setAssignments] = useState({}); // `${jobId}-${paramId}` -> assistantId
  const [success, setSuccess] = useState("");
  const [dispatchLoading, setDispatchLoading] = useState(
    () => !isCached(CACHE_KEYS.JOBS_HEAD_ACTIVE),
  );
  const [submittingJobId, setSubmittingJobId] = useState(null);
  const [approvingJobId, setApprovingJobId] = useState(null);

  // Bulk dispatch state
  const [selectedJobIds, setSelectedJobIds] = useState(new Set());
  const [bulkBarVisible, setBulkBarVisible] = useState(false);
  const [bulkAnalystId, setBulkAnalystId] = useState("");
  const [bulkDeadlineDate, setBulkDeadlineDate] = useState("");
  const [bulkDeadlineTime, setBulkDeadlineTime] = useState("");
  const [isBulkConfirmOpen, setIsBulkConfirmOpen] = useState(false);
  const [isBulkDispatching, setIsBulkDispatching] = useState(false);

  // Format deadline for display in confirm modal (no external dep)
  const formatBulkDeadline = (date, time) => {
    if (!date || !time) return "";
    const d = new Date(`${date}T${time}`);
    return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  // Slide the bar out, then clear selection after animation
  const dismissBulkBar = () => {
    setBulkBarVisible(false);
    setTimeout(() => {
      setSelectedJobIds(new Set());
      setBulkAnalystId("");
      setBulkDeadlineDate("");
      setBulkDeadlineTime("");
    }, 280);
  };

  // Return Job State
  const [returnModalData, setReturnModalData] = useState(null); // { jobId: string, dept: string }
  const [returnNote, setReturnNote] = useState("");
  const [isReturning, setIsReturning] = useState(false);
  const [detailsJob, setDetailsJob] = useState(null);

  // Sample transfer state

  const filterActiveHeadJobs = (dataArray) => {
    const dept = user?.department ? user.department.toLowerCase() : "";
    return dataArray.filter((j) => {
      const dKey = dept === "chemical" ? "chemical" : dept;
      const dist = j.distribution ? j.distribution[dKey] : null;
      const headId = dist?.assignedHead?._id || dist?.assignedHead;
      return (
        ["PENDING", "PENDING_REVIEW", "REVIEW_APPROVED"].includes(dist?.status) &&
        (!headId || headId === user?._id)
      );
    });
  };

  const handleJobsData = (data) => {
    if (data && data.jobs) {
      setJobs(filterActiveHeadJobs(data.jobs));
      setHasMoreJobs(data.hasMore);
      setJobsCursor(data.nextCursor);
    } else if (Array.isArray(data)) {
      setJobs(filterActiveHeadJobs(data));
    }
  };

  const fetchJobs = () => {
    fetchWithCache(`${API_URL}/api/jobs?activeForHead=true`, CACHE_KEYS.JOBS_HEAD_ACTIVE, handleJobsData)
      .catch(console.error)
      .finally(() => setDispatchLoading(false));
  };

  const loadMoreJobs = async () => {
    if (!jobsCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await axios.get(`${API_URL}/api/jobs?activeForHead=true&cursor=${jobsCursor}`);
      setJobs(prev => [...prev, ...filterActiveHeadJobs(res.data.jobs || [])]);
      setHasMoreJobs(res.data.hasMore);
      setJobsCursor(res.data.nextCursor);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    const dept = user?.department ? user.department.toLowerCase() : "";
    fetchWithCache(`${API_URL}/api/users`, CACHE_KEYS.USERS, (data) =>
      setAssistants(
        data.filter(
          (u) => u.role === "ASSISTANT" && u.department === user?.department,
        ),
      ),
    ).catch(console.error);

    fetchJobs();
  }, [user]);

  const socket = useSocket();

  useEffect(() => {
    if (!socket) return;
    const updateJobs = () => {
      invalidateCache(CACHE_KEYS.JOBS_HEAD_ACTIVE);
      fetchJobs();
    };
    const updateBoth = () => {
      updateJobs();
    };

    socket.on("JOB_CREATED", updateBoth);
    socket.on("JOB_UPDATED", updateBoth);
    socket.on("JOB_DELETED", updateBoth);
    socket.on("JOB_RETEST_INITIATED", updateBoth);
    socket.on("TRANSFER_RECEIVED", updateBoth);
    socket.on("TEST_SUBMITTED", updateBoth);
    socket.on("TEST_REVIEWED", updateBoth);
    socket.on("JOB_HELD", updateBoth);

    return () => {
      socket.off("JOB_CREATED", updateBoth);
      socket.off("JOB_UPDATED", updateBoth);
      socket.off("JOB_DELETED", updateBoth);
      socket.off("JOB_RETEST_INITIATED", updateBoth);
      socket.off("TRANSFER_RECEIVED", updateBoth);
      socket.off("TEST_SUBMITTED", updateBoth);
      socket.off("TEST_REVIEWED", updateBoth);
      socket.off("JOB_HELD", updateBoth);
    };
  }, [socket, user]);


  const getDeptParams = (job) => {
    const params =
      job?.parameters?.filter((p) => {
        if (!p || !p.parameterId) return false;
        const d = user?.department ? user.department.toLowerCase() : "";
        const pt = p.type ? p.type.toLowerCase() : "";
        if ((d === "chemical" || d === "chemical") && pt === "chemical")
          return true;
        if (d === "micro" && pt === "micro") return true;
        return false;
      }) || [];

    // Inject virtual parameters for Food Pesticide Panels (only for Chemical department)
    if (
      user?.department?.toLowerCase() === "chemical" &&
      job?.pesticidePanel?.enabled &&
      job?.pesticidePanel?.panelType === "food"
    ) {
      params.push({
        parameterId: { _id: "panel-gcmsms" },
        name: "Pesticide Panel (GCMSMS)",
        type: "Chemical",
        unit: "mg/kg",
        isPanel: true,
        panelName: "GCMSMS",
      });
      params.push({
        parameterId: { _id: "panel-lcmsms" },
        name: "Pesticide Panel (LCMSMS)",
        type: "Chemical",
        unit: "mg/kg",
        isPanel: true,
        panelName: "LCMSMS",
      });
    }

    return params;
  };

  const handleAssign = (jobId, paramId, assistantId) => {
    setAssignments((prev) => ({
      ...prev,
      [`${jobId}-${paramId}`]: assistantId,
    }));
  };

  const handleAssignAll = (jobId, assistantId, deptParams) => {
    if (!assistantId) return;
    const newAssignments = { ...assignments };
    deptParams.forEach((p) => {
      newAssignments[`${jobId}-${p.parameterId._id}`] = assistantId;
    });
    setAssignments(newAssignments);
  };

  const handleSubmit = async (job) => {
    const deptParams = getDeptParams(job);
    const dDate = deadlineDates[job._id];
    const dTime = deadlineTimes[job._id];
    const deadline = dDate && dTime ? `${dDate}T${dTime}` : null;

    // Validate all params assigned
    const allAssigned = deptParams.every(
      (p) => assignments[`${job._id}-${p.parameterId._id}`],
    );
    if (!allAssigned) return alert("Please assign all parameters to analysts");
    if (!deadline) return alert("Please set a submission deadline");

    setSubmittingJobId(job._id);
    try {
      const assignmentList = deptParams.map((p) => ({
        parameterId: p.parameterId._id,
        name: p.name,
        type: p.type,
        unit: p.unit,
        specification: p.specification || '',
        isPanel: p.isPanel,
        panelName: p.panelName,
        assignedTo: assignments[`${job._id}-${p.parameterId._id}`],
      }));

      await axios.post(`${API_URL}/api/tests/instances`, {
        jobId: job._id,
        deadline,
        assignments: assignmentList,
      });

      // Immediately remove from UI for snappy experience
      setJobs((prev) => prev.filter((j) => j._id !== job._id));

      setSuccess(`Job ${formatJobCode(job.jobCode)} dispatched successfully!`);
      setExpandedJobId(null);
      setTimeout(() => setSuccess(""), 4000);

      // Refresh jobs list
      invalidateCache(CACHE_KEYS.JOBS_HEAD_ACTIVE);
      fetchJobs();
    } catch (err) {
      console.error(err);
      alert("Error: " + (err.response?.data?.message || err.message));
    } finally {
      setSubmittingJobId(null);
    }
  };

  const handleReturn = async (e) => {
    e.preventDefault();
    if (!returnModalData || !returnNote.trim()) return;

    setIsReturning(true);
    try {
      await axios.post(`${API_URL}/api/jobs/${returnModalData.jobId}/return`, {
        department: returnModalData.dept,
        note: returnNote,
      });

      setJobs((prev) => prev.filter((j) => j._id !== returnModalData.jobId));
      setSuccess(`Job returned to Admin Officer successfully.`);
      setReturnModalData(null);
      setReturnNote("");
      setTimeout(() => setSuccess(""), 4000);

      invalidateCache(CACHE_KEYS.JOBS_HEAD_ACTIVE);
      fetchJobs();
    } catch (err) {
      console.error(err);
      alert(
        "Error returning job: " + (err.response?.data?.message || err.message),
      );
    } finally {
      setIsReturning(false);
    }
  };

  const toggleExpand = (jobId) => {
    setExpandedJobId((prev) => (prev === jobId ? null : jobId));
  };

  const toggleJobSelection = (jobId) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
        setExpandedJobId((prevExpanded) => (prevExpanded === jobId ? null : prevExpanded));
      }
      // Show bar when >= 2 selected, hide when < 2
      if (next.size >= 2) setBulkBarVisible(true);
      else setBulkBarVisible(false);
      return next;
    });
  };

  const openBulkConfirmModal = () => {
    if (!bulkAnalystId) return alert("Please select an analyst");
    if (!bulkDeadlineDate || !bulkDeadlineTime) return alert("Please set a deadline");
    setIsBulkConfirmOpen(true);
  };

  const handleBulkDispatch = async () => {
    const bulkId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const deadline = `${bulkDeadlineDate}T${bulkDeadlineTime}`;
    const selectedJobs = jobs.filter((j) => selectedJobIds.has(j._id));
    const analystName = assistants.find((a) => a._id === bulkAnalystId)?.name || "Analyst";
    let successCount = 0;

    setIsBulkDispatching(true);
    setIsBulkConfirmOpen(false);

    const bulkMeta = {
      bulkId,
      dispatchedBy: user._id,
      dispatchedAt: new Date().toISOString(),
      totalJobsInBatch: selectedJobs.length,
      jobCodes: selectedJobs.map((j) => String(j.jobCode)),
    };

    for (const job of selectedJobs) {
      const deptParams = getDeptParams(job);

      const assignmentList = deptParams.map((p) => ({
        parameterId: p.parameterId._id,
        name: p.name,
        type: p.type,
        unit: p.unit,
        specification: p.specification || "",
        isPanel: p.isPanel,
        panelName: p.panelName,
        assignedTo: bulkAnalystId,
      }));

      try {
        await axios.post(`${API_URL}/api/tests/instances`, {
          jobId: job._id,
          deadline,
          assignments: assignmentList,
          bulkDispatch: bulkMeta,
        });

        // Remove card immediately on success
        setJobs((prev) => prev.filter((j) => j._id !== job._id));
        setSelectedJobIds((prev) => {
          const n = new Set(prev);
          n.delete(job._id);
          return n;
        });
        successCount++;
      } catch (err) {
        console.error(`Failed to dispatch job ${job.jobCode}:`, err);
      }
    }

    // Slide bar out after dispatch
    setBulkBarVisible(false);
    setIsBulkDispatching(false);
    setTimeout(() => {
      setSelectedJobIds(new Set());
      setBulkAnalystId("");
      setBulkDeadlineDate("");
      setBulkDeadlineTime("");
    }, 280);

    if (successCount > 0) {
      setSuccess(`${successCount} job${successCount !== 1 ? "s" : ""} dispatched to ${analystName}`);
      setTimeout(() => setSuccess(""), 4000);
      invalidateCache(CACHE_KEYS.JOBS_HEAD_ACTIVE);
      fetchJobs();
    }
  };




  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem" }}>Job Dispatcher</h1>
      {success && (
        <div
          style={{
            marginBottom: "1rem",
            color: "var(--color-success)",
            backgroundColor: "var(--color-success-light)",
            padding: "1rem",
            borderRadius: "var(--radius-md)",
            fontWeight: 500,
          }}
        >
          {success}
        </div>
      )}

      {/* ── Sample Transfers Section ── */}
      <TransferManagement />


      {dispatchLoading && jobs.length === 0 ? (
        <div className="card"><Spinner message="Loading pending jobs..." /></div>
      ) : jobs.length === 0 ? (
        <div
          className="card"
          style={{
            textAlign: "center",
            padding: "3rem",
            color: "var(--color-text-muted)",
          }}
        >
          <CheckCircle
            size={40}
            style={{ marginBottom: "1rem", opacity: 0.4 }}
          />
          <p style={{ fontSize: "1.1rem", fontWeight: 500 }}>
            No pending jobs to dispatch
          </p>
          <p style={{ fontSize: "0.85rem" }}>
            All jobs have been assigned. Check back later.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", paddingBottom: selectedJobIds.size >= 2 ? "120px" : "0" }}>
          {jobs.map((job) => {
            const deptParams = getDeptParams(job);
            const isExpanded = expandedJobId === job._id;
            const microCount = deptParams.filter(
              (p) => p.type?.toLowerCase() === "micro",
            ).length;
            const chemCount = deptParams.filter(
              (p) => p.type?.toLowerCase() === "chemical",
            ).length;

            const isMultiDept =
              job.distribution?.micro?.required &&
              job.distribution?.chemical?.required;
            const myDept = user?.department
              ? user.department.toLowerCase()
              : "";
            const iAmChemical = myDept === "chemical";
            const transferState = job.sampleTransferState;

            let canChemicalDispatch = true;
            if (iAmChemical && isMultiDept) {
              if (
                ["PENDING_APPROVAL", "PENDING_TRANSFER", "IN_TRANSIT"].includes(
                  transferState,
                )
              ) {
                canChemicalDispatch = false;
              }
            }

            return (
              <div
                key={job._id}
                className="card"
                style={{
                  padding: 0,
                  overflow: "hidden",
                  border: isExpanded
                    ? "2px solid var(--color-primary)"
                    : "1px solid var(--color-border)",
                  transition: "border-color 0.2s",
                }}
              >
                {/* Card Header — always visible */}
                <div
                  onClick={() => toggleExpand(job._id)}
                  style={{
                    padding: "1.25rem 1.5rem",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    backgroundColor: isExpanded
                      ? "var(--color-surface-hover)"
                      : "var(--color-surface)",
                    transition: "background-color 0.2s",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                    }}
                  >
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleJobSelection(job._id);
                      }}
                      style={{
                        width: "26px",
                        height: "26px",
                        minWidth: "26px",
                        borderRadius: "6px",
                        border: selectedJobIds.has(job._id)
                          ? "2px solid var(--color-primary)"
                          : "2px solid var(--color-border)",
                        backgroundColor: selectedJobIds.has(job._id)
                          ? "var(--color-primary)"
                          : "var(--color-surface)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.15s ease",
                        flexShrink: 0,
                      }}
                    >
                      {selectedJobIds.has(job._id) && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path
                            d="M2 7L5.5 10.5L12 3.5"
                            stroke="white"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                    <div
                      style={{
                        padding: "0.5rem",
                        backgroundColor: "var(--color-primary)15",
                        borderRadius: "var(--radius-md)",
                      }}
                    >
                      <ClipboardCheck size={22} color="var(--color-primary)" />
                    </div>
                    <div>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: "1rem",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {formatJobCode(job.jobCode)}
                      </div>
                      <div
                        style={{
                          fontSize: "0.85rem",
                          color: "var(--color-text-muted)",
                          marginTop: "0.15rem",
                        }}
                      >
                        {job.clientName}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1.5rem",
                    }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailsJob(job);
                      }}
                      className="btn btn-secondary"
                      style={{
                        padding: "0.4rem 0.8rem",
                        fontSize: "0.8rem",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                      title="View all customer, sample, and compliance details"
                    >
                      <ClipboardCheck size={14} /> View Details
                    </button>
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        {formatDate(job.createdAt)}
                      </div>
                      <div style={{ fontSize: "0.8rem", marginTop: "0.15rem" }}>
                        <span
                          style={{
                            fontWeight: 600,
                            color: "var(--color-primary)",
                          }}
                        >
                          {deptParams.length}
                        </span>
                        <span style={{ color: "var(--color-text-muted)" }}>
                          {" "}
                          parameter{deptParams.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronDown size={20} color="var(--color-primary)" />
                    ) : (
                      <ChevronRight size={20} color="var(--color-text-muted)" />
                    )}
                  </div>
                </div>

                {/* Expanded Dispatch Form */}
                {isExpanded && (
                  <div
                    style={{
                      padding: "1.5rem",
                      borderTop: "1px solid var(--color-border)",
                      backgroundColor: "var(--color-surface)",
                    }}
                  >
                    {deptParams.length === 0 ? (
                      <p
                        style={{
                          color: "var(--color-text-muted)",
                          textAlign: "center",
                          padding: "1rem",
                        }}
                      >
                        No parameters for your department in this job.
                      </p>
                    ) : (
                      (() => {
                        const dept = user?.department
                          ? user.department.toLowerCase()
                          : "";
                        const dKey = dept === "chemical" ? "chemical" : dept;
                        const otherKey =
                          dKey === "chemical" ? "micro" : "chemical";
                        const distStatus = job.distribution[dKey].status;
                        const isMultiDept =
                          job.distribution.micro.required &&
                          job.distribution.chemical.required;

                        const isReviewing = distStatus === "PENDING_REVIEW";
                        const isApproved = distStatus === "REVIEW_APPROVED";
                        const isPending = distStatus === "PENDING";

                        return (
                          <>
                            {/* Parameter rows (Always visible) */}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "0.5rem",
                                marginBottom: "1.5rem",
                              }}
                            >
                              {deptParams.map((p) => (
                                <div
                                  key={p.parameterId._id}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    backgroundColor:
                                      "var(--color-surface-hover)",
                                    padding: "0.6rem 1rem",
                                    borderRadius: "var(--radius-md)",
                                    gap: "1rem",
                                  }}
                                >
                                  <div style={{ flex: 1 }}>
                                    <span style={{ fontWeight: 600 }}>
                                      {p.name}
                                    </span>{" "}
                                    <span
                                      style={{
                                        fontSize: "0.8rem",
                                        color: "var(--color-text-muted)",
                                      }}
                                    >
                                      ({p.unit})
                                    </span>
                                  </div>

                                  {isPending && (
                                    <select
                                      value={
                                        assignments[
                                        `${job._id}-${p.parameterId._id}`
                                        ] || ""
                                      }
                                      onChange={(e) =>
                                        handleAssign(
                                          job._id,
                                          p.parameterId._id,
                                          e.target.value,
                                        )
                                      }
                                      required
                                      disabled={
                                        iAmChemical && !canChemicalDispatch
                                      }
                                      style={{
                                        minWidth: "180px",
                                        opacity:
                                          iAmChemical && !canChemicalDispatch
                                            ? 0.6
                                            : 1,
                                      }}
                                    >
                                      <option value="" disabled>
                                        Select Analyst...
                                      </option>
                                      {assistants.map((ast) => (
                                        <option key={ast._id} value={ast._id}>
                                          {ast.name}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* Action Blocks based on Status */}
                            {isReviewing && (
                              <div
                                style={{
                                  textAlign: "center",
                                  padding: "1.5rem",
                                  borderTop: "1px solid var(--color-border)",
                                }}
                              >
                                <h3
                                  style={{
                                    color: "var(--color-warning)",
                                    marginBottom: "0.5rem",
                                    fontSize: "1.2rem",
                                  }}
                                >
                                  Approval Required
                                </h3>
                                <p
                                  style={{
                                    color: "var(--color-text-muted)",
                                    fontSize: "0.9rem",
                                    marginBottom: "1.5rem",
                                  }}
                                >
                                  Please review the job details and parameters
                                  above before approving. You must approve the
                                  job before analysts can be assigned.
                                </p>
                                <div
                                  style={{
                                    display: "flex",
                                    gap: "1rem",
                                    justifyContent: "center",
                                  }}
                                >
                                  <button
                                    disabled={approvingJobId === job._id}
                                    onClick={async () => {
                                      if (approvingJobId === job._id) return;
                                      
                                      setApprovingJobId(job._id);
                                      try {
                                        await axios.put(
                                          `${API_URL}/api/jobs/${job._id}/approve-review`,
                                          {},
                                          {
                                            headers: {
                                              Authorization: `Bearer ${localStorage.getItem("token")}`,
                                            },
                                          },
                                        );
                                        invalidateCache(CACHE_KEYS.JOBS_HEAD_ACTIVE);
                                        fetchJobs();
                                      } catch (err) {
                                        alert(
                                          err.response?.data?.message ||
                                          "Error approving job",
                                        );
                                      } finally {
                                        setApprovingJobId(null);
                                      }
                                    }}
                                    className="btn btn-success"
                                    style={{
                                      padding: "0.6rem 1.5rem",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "0.5rem",
                                    }}
                                  >
                                    {approvingJobId === job._id ? (
                                      <Spinner size="sm" message="Approving..." color="#fff" />
                                    ) : (
                                      <><ClipboardCheck size={18} /> Approve Job</>
                                    )}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setReturnModalData({
                                        jobId: job._id,
                                        dept: dKey,
                                      });
                                      setReturnNote("");
                                    }}
                                    className="btn btn-secondary"
                                    style={{
                                      padding: "0.6rem 1.5rem",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "0.5rem",
                                      color: "#B45309",
                                      border: "1px solid #F59E0B",
                                      backgroundColor: "#FFFBEB",
                                    }}
                                  >
                                    <RotateCcw size={18} /> Return Job
                                  </button>
                                </div>
                              </div>
                            )}

                            {isApproved && (
                              <div
                                style={{
                                  textAlign: "center",
                                  padding: "1.5rem",
                                  borderTop: "1px solid var(--color-border)",
                                }}
                              >
                                <h3
                                  style={{
                                    color: "var(--color-success)",
                                    marginBottom: "0.5rem",
                                    fontSize: "1.2rem",
                                  }}
                                >
                                  Approved by{" "}
                                  {dKey === "micro" ? "Micro" : "Chemical"}
                                </h3>
                                <p
                                  style={{
                                    color: "var(--color-text-muted)",
                                    fontSize: "0.9rem",
                                    marginBottom: "1.5rem",
                                  }}
                                >
                                  Waiting for the{" "}
                                  {otherKey === "micro" ? "Micro" : "Chemical"}{" "}
                                  department to approve their details before the
                                  job unlocks.
                                </p>
                                <button
                                  onClick={() => {
                                    setReturnModalData({
                                      jobId: job._id,
                                      dept: dKey,
                                    });
                                    setReturnNote("");
                                  }}
                                  className="btn btn-secondary"
                                  style={{
                                    padding: "0.6rem 1.5rem",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.5rem",
                                    color: "#B45309",
                                    border: "1px solid #F59E0B",
                                    backgroundColor: "#FFFBEB",
                                    margin: "0 auto",
                                  }}
                                >
                                  <RotateCcw size={18} /> Return Job
                                </button>
                              </div>
                            )}

                            {isPending && (
                              <>
                                {iAmChemical && !canChemicalDispatch ? (
                                  (() => {
                                    // Determine if this job is the non-anchor sibling (should redirect to sibling for transfer)
                                    const siblingIsMultiDept =
                                      job.siblingJobId &&
                                      job.siblingJobId.distribution?.micro
                                        ?.required &&
                                      job.siblingJobId.distribution?.chemical
                                        ?.required;
                                    const isNonAnchor =
                                      job.sample?.nabl_type === "Non Nabl" &&
                                      siblingIsMultiDept;

                                    return (
                                      <div
                                        style={{
                                          textAlign: "center",
                                          padding: "1.5rem",
                                          borderTop:
                                            "1px solid var(--color-border)",
                                          backgroundColor:
                                            "var(--color-surface-hover)",
                                        }}
                                      >
                                        <h3
                                          style={{
                                            color: "var(--color-warning)",
                                            marginBottom: "0.5rem",
                                            fontSize: "1.1rem",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: "0.5rem",
                                          }}
                                        >
                                          <Lock size={18} /> Dispatch Locked
                                        </h3>
                                        {transferState ===
                                          "PENDING_APPROVAL" && (
                                            <p
                                              style={{
                                                color: "var(--color-text-muted)",
                                                fontSize: "0.9rem",
                                                marginBottom: 0,
                                              }}
                                            >
                                              Waiting for sibling job to be
                                              approved before transfer can begin.
                                            </p>
                                          )}
                                        {transferState ===
                                          "PENDING_TRANSFER" && (
                                            <p
                                              style={{
                                                color: "var(--color-text-muted)",
                                                fontSize: "0.9rem",
                                                marginBottom: 0,
                                              }}
                                            >
                                              {isNonAnchor
                                                ? `Please accept the sample transfer in the NABL sibling job (${job.siblingJobId?.jobCode || "sibling"}) first.`
                                                : "Waiting for Micro department to transfer the sample."}
                                            </p>
                                          )}
                                        {transferState === "IN_TRANSIT" && (
                                          <p
                                            style={{
                                              color: "var(--color-text-muted)",
                                              fontSize: "0.9rem",
                                              marginBottom: 0,
                                            }}
                                          >
                                            {isNonAnchor
                                              ? `Please accept the sample transfer in the NABL sibling job (${job.siblingJobId?.jobCode || "sibling"}) first.`
                                              : "Sample is in transit. Please confirm receipt from your dashboard above."}
                                          </p>
                                        )}
                                      </div>
                                    );
                                  })()
                                ) : (
                                  <>
                                    {/* Bulk assign */}
                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        marginBottom: "1rem",
                                        borderTop:
                                          "1px solid var(--color-border)",
                                        paddingTop: "1.5rem",
                                      }}
                                    >
                                      <div></div>
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "0.5rem",
                                        }}
                                      >
                                        <label
                                          style={{
                                            fontSize: "0.85rem",
                                            color: "var(--color-text-muted)",
                                          }}
                                        >
                                          Bulk assign all to:
                                        </label>
                                        <select
                                          onChange={(e) => {
                                            handleAssignAll(
                                              job._id,
                                              e.target.value,
                                              deptParams,
                                            );
                                            e.target.value = "";
                                          }}
                                          defaultValue=""
                                          style={{ minWidth: "150px" }}
                                        >
                                          <option value="" disabled>
                                            Select analyst...
                                          </option>
                                          {assistants.map((ast) => (
                                            <option
                                              key={ast._id}
                                              value={ast._id}
                                            >
                                              {ast.name}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    </div>

                                    {/* Deadline + Submit */}
                                    <div
                                      style={{
                                        display: "flex",
                                        gap: "1rem",
                                        alignItems: "flex-end",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <div style={{ flex: "1 1 180px" }}>
                                        <label
                                          style={{
                                            display: "block",
                                            fontSize: "0.82rem",
                                            marginBottom: "0.4rem",
                                            fontWeight: 500,
                                            color: "var(--color-text-muted)",
                                          }}
                                        >
                                          Deadline Date{" "}
                                          <span
                                            style={{
                                              color: "var(--color-danger)",
                                            }}
                                          >
                                            *
                                          </span>
                                        </label>
                                        <input
                                          type="date"
                                          value={deadlineDates[job._id] || ""}
                                          onChange={(e) => {
                                            setDeadlineDates((prev) => ({
                                              ...prev,
                                              [job._id]: e.target.value,
                                            }));
                                            setDeadlineTimes((prev) => {
                                              if (
                                                !prev[job._id] &&
                                                e.target.value
                                              ) {
                                                return {
                                                  ...prev,
                                                  [job._id]: "17:00",
                                                };
                                              }
                                              return prev;
                                            });
                                          }}
                                          required
                                          style={{ width: "100%" }}
                                        />
                                      </div>
                                      <div style={{ flex: "1 1 130px" }}>
                                        <label
                                          style={{
                                            display: "block",
                                            fontSize: "0.82rem",
                                            marginBottom: "0.4rem",
                                            fontWeight: 500,
                                            color: "var(--color-text-muted)",
                                          }}
                                        >
                                          Due Time{" "}
                                          <span
                                            style={{
                                              color: "var(--color-danger)",
                                            }}
                                          >
                                            *
                                          </span>
                                        </label>
                                        <input
                                          type="time"
                                          value={deadlineTimes[job._id] || ""}
                                          onChange={(e) =>
                                            setDeadlineTimes((prev) => ({
                                              ...prev,
                                              [job._id]: e.target.value,
                                            }))
                                          }
                                          required
                                          style={{ width: "100%" }}
                                        />
                                      </div>
                                      {deadlineDates[job._id] && deadlineTimes[job._id] && isOverdue(`${deadlineDates[job._id]}T${deadlineTimes[job._id]}`) && (
                                        <div style={{ flex: '1 1 100%', color: 'var(--color-danger)', fontSize: '0.75rem', fontWeight: 600, marginTop: '0.2rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                          <AlertTriangle size={14} /> This deadline is in the past
                                        </div>
                                      )}
                                      <div
                                        style={{
                                          flex: "0 0 auto",
                                          display: "flex",
                                          gap: "0.5rem",
                                          alignItems: 'flex-start'
                                        }}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => handleSubmit(job)}
                                          className="btn btn-primary"
                                          disabled={submittingJobId === job._id}
                                          style={{
                                            padding: "0.6rem 1.5rem",
                                            justifyContent: "center",
                                          }}
                                        >
                                          {submittingJobId === job._id ? (
                                            <Spinner
                                              size="sm"
                                              message="Dispatching..."
                                              color="#fff"
                                            />
                                          ) : (
                                            "Dispatch Job"
                                          )}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setReturnModalData({
                                              jobId: job._id,
                                              dept: dKey,
                                            });
                                            setReturnNote("");
                                          }}
                                          className="btn btn-secondary"
                                          style={{
                                            padding: "0.6rem 1.5rem",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                          }}
                                        >
                                          <RotateCcw size={18} /> Return Job
                                        </button>
                                      </div>
                                    </div>
                                  </>
                                )}
                              </>
                            )}
                          </>
                        );
                      })()
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Return to Officer Modal */}
      {returnModalData && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: "500px",
              padding: "2rem",
              animation: "slideUp 0.3s ease",
              borderTop: "4px solid #EF4444",
            }}
          >
            <h2
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                color: "#B45309",
                margin: "0 0 1rem 0",
                fontSize: "1.25rem",
              }}
            >
              <RotateCcw size={20} /> Return Job to Admin Officer
            </h2>
            <p
              style={{
                fontSize: "0.9rem",
                color: "var(--color-text-muted)",
                marginBottom: "1.5rem",
                lineHeight: 1.5,
              }}
            >
              Please provide a clear reason for returning this job. The Admin
              Officer will see this note.
            </p>
            <form onSubmit={handleReturn}>
              <div style={{ marginBottom: "1.5rem" }}>
                <label
                  style={{
                    display: "block",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                    fontSize: "0.9rem",
                  }}
                >
                  Reason for Return{" "}
                  <span style={{ color: "var(--color-danger)" }}>*</span>
                </label>
                <textarea
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                  placeholder="e.g. Missing required test parameter, incorrect volume stated, etc."
                  rows="4"
                  required
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--color-border)",
                    resize: "vertical",
                  }}
                ></textarea>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "1rem",
                  justifyContent: "flex-end",
                  marginTop: "1.5rem",
                }}
              >
                <button
                  type="button"
                  className="btn"
                  style={{
                    border: "1px solid var(--color-border)",
                    padding: "0.6rem 1.5rem",
                  }}
                  onClick={() => setReturnModalData(null)}
                  disabled={isReturning}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{
                    backgroundColor: "#EF4444",
                    border: "none",
                    padding: "0.6rem 1.5rem",
                  }}
                  disabled={isReturning || !returnNote.trim()}
                >
                  {isReturning ? (
                    <Spinner size="sm" color="#fff" />
                  ) : (
                    "Return Job"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detailsJob && (
        <JobDetailsModal job={detailsJob} onClose={() => setDetailsJob(null)} />
      )}

      {/* ── Bulk Action Bar ── */}
      {(selectedJobIds.size >= 2 || bulkBarVisible) && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 200,
            // Offset by sidebar width on desktop; sidebar is off-canvas on mobile
            paddingLeft: "var(--bulk-bar-sidebar-offset, 0px)",
          }}
          className={bulkBarVisible ? "bulk-action-bar bulk-bar-in" : "bulk-action-bar bulk-bar-out"}
        >
          <div
            style={{
              background: "linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)",
              borderTop: "2px solid var(--color-primary-light)",
              padding: "1rem 1.5rem",
              paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              boxShadow: "0 -8px 24px rgba(44,62,80,0.18)",
              flexWrap: "wrap",
            }}
          >
            {/* Left: selection count */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", color: "white" }}>
              <div style={{
                backgroundColor: "rgba(255,255,255,0.15)",
                borderRadius: "999px",
                padding: "0.35rem 0.9rem",
                fontWeight: 700,
                fontSize: "0.95rem",
                letterSpacing: "0.01em",
              }}>
                {selectedJobIds.size} selected
              </div>
              <span style={{ fontSize: "0.85rem", opacity: 0.75 }}>Bulk Dispatch</span>
            </div>

            {/* Right: controls */}
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <select
                value={bulkAnalystId}
                onChange={(e) => setBulkAnalystId(e.target.value)}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid rgba(255,255,255,0.25)",
                  backgroundColor: "rgba(255,255,255,0.1)",
                  color: "white",
                  fontSize: "0.9rem",
                  outline: "none",
                  minWidth: "140px",
                }}
              >
                <option value="" style={{ color: "#333", background: "#fff" }}>Select Analyst</option>
                {assistants.map((a) => (
                  <option key={a._id} value={a._id} style={{ color: "#333", background: "#fff" }}>
                    {a.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={bulkDeadlineDate}
                onChange={(e) => setBulkDeadlineDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid rgba(255,255,255,0.25)",
                  backgroundColor: "rgba(255,255,255,0.1)",
                  color: "white",
                  fontSize: "0.9rem",
                  colorScheme: "dark",
                  outline: "none",
                }}
              />
              <input
                type="time"
                value={bulkDeadlineTime}
                onChange={(e) => setBulkDeadlineTime(e.target.value)}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid rgba(255,255,255,0.25)",
                  backgroundColor: "rgba(255,255,255,0.1)",
                  color: "white",
                  fontSize: "0.9rem",
                  colorScheme: "dark",
                  outline: "none",
                }}
              />
              <button
                onClick={openBulkConfirmModal}
                disabled={isBulkDispatching}
                style={{
                  padding: "0.55rem 1.25rem",
                  borderRadius: "var(--radius-md)",
                  border: "none",
                  backgroundColor: "white",
                  color: "var(--color-primary-dark)",
                  fontWeight: 700,
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  transition: "opacity 0.2s",
                  opacity: isBulkDispatching ? 0.6 : 1,
                }}
              >
                {isBulkDispatching
                  ? <Spinner size="sm" color="var(--color-primary)" />
                  : <><Play size={15} fill="currentColor" /> Dispatch {selectedJobIds.size} jobs</>}
              </button>
              <button
                onClick={dismissBulkBar}
                title="Cancel selection"
                style={{
                  padding: "0.55rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  backgroundColor: "rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.7)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  transition: "all 0.2s",
                }}
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Confirm Modal ── */}
      {isBulkConfirmOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            backdropFilter: "blur(4px)",
            padding: "1rem",
          }}
          onClick={() => setIsBulkConfirmOpen(false)}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: "500px",
              padding: "2rem",
              animation: "slideUp 0.3s ease",
              borderTop: "4px solid var(--color-primary)",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                color: "var(--color-primary)",
                margin: "0 0 0.5rem 0",
                fontSize: "1.25rem",
              }}
            >
              <Play size={20} fill="var(--color-primary)" /> Confirm Bulk Dispatch
            </h2>
            <p
              style={{
                fontSize: "0.9rem",
                color: "var(--color-text-muted)",
                marginBottom: "1.5rem",
                lineHeight: 1.5,
              }}
            >
              The following jobs will be dispatched to the selected analyst with the given deadline.
            </p>

            {/* Summary */}
            <div style={{
              backgroundColor: "var(--color-background)",
              borderRadius: "var(--radius-md)",
              padding: "1rem",
              marginBottom: "1.25rem",
              border: "1px solid var(--color-border)",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}>Analyst</span>
                <span style={{ fontWeight: 600 }}>{assistants.find(a => a._id === bulkAnalystId)?.name}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}>Deadline</span>
                <span style={{ fontWeight: 600 }}>{formatBulkDeadline(bulkDeadlineDate, bulkDeadlineTime)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}>Total Jobs</span>
                <span style={{ fontWeight: 600 }}>{selectedJobIds.size}</span>
              </div>
            </div>

            {/* Job list */}
            <p style={{ fontWeight: 600, marginBottom: "0.75rem", fontSize: "0.9rem" }}>Selected Jobs:</p>
            <ul style={{ listStyleType: "none", padding: 0, margin: "0 0 1.5rem 0", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {jobs
                .filter((j) => selectedJobIds.has(j._id))
                .map((j) => (
                  <li key={j._id} style={{
                    padding: "0.6rem 0.75rem",
                    backgroundColor: "var(--color-background)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--color-border)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "0.9rem" }}>{formatJobCode(j.jobCode)}</span>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "0.85rem" }}>{j.clientName}</span>
                  </li>
                ))}
            </ul>

            {/* Actions */}
            <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn"
                style={{ border: "1px solid var(--color-border)", padding: "0.6rem 1.5rem" }}
                onClick={() => setIsBulkConfirmOpen(false)}
                disabled={isBulkDispatching}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleBulkDispatch}
                disabled={isBulkDispatching}
                style={{ padding: "0.6rem 1.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}
              >
                {isBulkDispatching
                  ? <Spinner size="sm" color="#fff" />
                  : <><Play size={15} fill="white" /> Confirm Dispatch</>}
              </button>
            </div>
          </div>
        </div>
      )}

      <InfiniteScroll hasMore={hasMoreJobs} isLoading={isLoadingMore} onLoadMore={loadMoreJobs} />
    </div>
  );
}
