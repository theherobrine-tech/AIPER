import React, { useState } from "react";
import {
  Search,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Filter,
  Clock,
  XCircle,
  Edit,
  FileText,
  PauseCircle,
  Loader2,
} from "lucide-react";
import JobTimeline from "./JobTimeline";
import GlobalJobHistory from "./GlobalJobHistory";
import AssignmentHistory from "./AssignmentHistory";
import ReportModal from "./ReportModal";
import InfiniteScroll from "./InfiniteScroll";
import { formatJobCode } from "../utils/serialUtils";
import { formatDate } from "../utils/dateUtils";

export default function JobLogTable({
  jobs,
  title = "Job Logs",
  onReopen,
  onDeleteJob,
  onEditJob,
  onHoldJob,
  editingJobId,
  loadingJobId,
  defaultExpandedId,
  hasMoreData,
  onLoadMoreData,
  isLoadingMoreData,
  onServerSearch,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [expandedJobId, setExpandedJobId] = useState(defaultExpandedId || null);
  const [page, setPage] = useState(1);
  // True during the debounce window — prevents the local filter from showing
  // a false "no results" against stale data before the server responds
  const [serverSearchPending, setServerSearchPending] = useState(false);
  const PAGE_SIZE = 15;

  React.useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter]);

  // Debounced server search
  React.useEffect(() => {
    if (!onServerSearch) return;
    if (searchTerm) setServerSearchPending(true);
    const timeoutId = setTimeout(() => {
      setServerSearchPending(false);
      onServerSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchTerm, onServerSearch]);

  React.useEffect(() => {
    if (defaultExpandedId) {
      setExpandedJobId(defaultExpandedId);
      setTimeout(() => {
        const row = document.getElementById(`job-row-${defaultExpandedId}`);
        if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [defaultExpandedId]);

  // Helper to determine a simple global status for a job
  const getJobStatus = (job) => {
    if (job.status === "ON_HOLD") return "ON_HOLD";
    if (job.status === "CANCELLED") return "CANCELLED";
    
    let statuses = [];
    if (job.distribution?.micro?.required)
      statuses.push(job.distribution.micro.status);
    if (job.distribution?.chemical?.required)
      statuses.push(job.distribution.chemical.status);

    if (statuses.length === 0) return "PENDING";
    if (statuses.some((s) => s === "RETURNED")) return "RETURNED";
    if (statuses.every((s) => s === "COMPLETED")) return "COMPLETED";
    if (statuses.every((s) => s === "PENDING")) return "PENDING";
    // Any mix (e.g. one COMPLETED + one PENDING, or any ASSIGNED_TO_ASSISTANT) = in progress
    return "IN_PROGRESS";
  };

  // Group jobs: only show ROOT jobs in the main table. Child jobs will be fetched/passed inside JobTimeline.
  const rootJobs = jobs.filter((j) => !j.isRetest);

  // When server search is active, skip local filtering entirely —
  // the server owns the result set. Only apply local status filter.
  const filteredJobsAll = (onServerSearch && searchTerm)
    ? rootJobs.filter((j) => {
        const jobStatus = getJobStatus(j);
        return statusFilter === "ALL" || jobStatus === statusFilter;
      })
    : rootJobs.filter((j) => {
        const term = searchTerm.toLowerCase();
        const matchSearch =
          j.jobCode.toLowerCase().includes(term) ||
          j.clientName.toLowerCase().includes(term);
        const jobStatus = getJobStatus(j);
        const matchStatus = statusFilter === "ALL" || jobStatus === statusFilter;
        return matchSearch && matchStatus;
      });

  const totalPages = Math.ceil(filteredJobsAll.length / PAGE_SIZE);
  const visibleJobs = filteredJobsAll.slice(0, page * PAGE_SIZE);

  const handleLoadMore = () => {
    if (page < totalPages) {
      setPage(p => p + 1);
      
      // Proactive Pre-fetching:
      // If we are now on the last page of our locally loaded data, 
      // fire the network request for the next batch in the background.
      // This hides the 2-second API delay completely!
      if (page + 1 >= totalPages && hasMoreData && onLoadMoreData && !isLoadingMoreData) {
        onLoadMoreData();
      }
    } else if (hasMoreData && onLoadMoreData && !isLoadingMoreData) {
      onLoadMoreData();
      // Increase page immediately so the newly loaded data shows up
      setPage(p => p + 1);
    }
  };

  const toggleExpand = (id) => {
    setExpandedJobId(expandedJobId === id ? null : id);
  };

  const [historyJob, setHistoryJob] = useState(null);
  const [selectedReportJob, setSelectedReportJob] = useState(null);

  const StatusBadge = ({ status, isLoading }) => {
    if (isLoading) {
      return (
        <span
          className="badge badge-warning"
          style={{ backgroundColor: "#FEF3C7", color: "#D97706", display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'fit-content' }}
        >
          <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
          Updating...
        </span>
      );
    }

    switch (status) {
      case "ON_HOLD":
        return (
          <span
            className="badge"
            style={{ backgroundColor: "#F59E0B", color: "white" }}
          >
            Held
          </span>
        );
      case "COMPLETED":
        return <span className="badge badge-success">Completed</span>;
      case "IN_PROGRESS":
        return <span className="badge badge-warning">In Progress</span>;
      case "REOPENED":
        return (
          <span
            className="badge badge-warning"
            style={{ backgroundColor: "#f59e0b" }}
          >
            Reopened
          </span>
        );
      case "RETURNED":
        return (
          <span
            className="badge"
            style={{ backgroundColor: "#EF4444", color: "white" }}
          >
            Returned
          </span>
        );
      default:
        return (
          <span
            className="badge"
            style={{
              backgroundColor: "var(--color-border)",
              color: "var(--color-text-main)",
            }}
          >
            Pending
          </span>
        );
    }
  };



  const showActions =
    !!onDeleteJob ||
    !!onEditJob ||
    jobs.some((j) => j.history && j.history.length > 0) ||
    jobs.some((j) => getJobStatus(j) === "COMPLETED");

  return (
    <div className="card" style={{ padding: "0", overflow: "hidden" }}>
      <div
        style={{
          padding: "1.5rem",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: "var(--color-surface)",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <h2 style={{ margin: 0, width: "100%" }}>{title}</h2>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ position: "relative" }}>
            <Search
              size={18}
              style={{
                position: "absolute",
                left: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--color-text-muted)",
              }}
            />
            <input
              type="text"
              placeholder="Search Client or Code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                paddingLeft: "2.2rem",
                paddingRight: "1rem",
                paddingBottom: "0.4rem",
                paddingTop: "0.4rem",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
              }}
            />
          </div>
          <div style={{ position: "relative" }}>
            <Filter
              size={18}
              style={{
                position: "absolute",
                left: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--color-text-muted)",
              }}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                paddingLeft: "2.2rem",
                appearance: "auto",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                paddingBottom: "0.4rem",
                paddingTop: "0.4rem",
              }}
            >
              <option value="ALL">All Status</option>
              <option value="PENDING">Pending</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="RETURNED">Returned</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
        </div>
      </div>

      <div
        className="hide-on-mobile"
        style={{ overflowX: "auto", width: "100%" }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            minWidth: "800px",
          }}
        >
          <thead style={{ backgroundColor: "var(--color-surface-hover)" }}>
            <tr>
              <th style={{ width: "50px" }}></th>
              <th>Job Code</th>
              <th>Client Name</th>
              <th>Date Created</th>
              <th>Overall Status</th>
              {showActions && <th style={{ textAlign: "right" }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visibleJobs.length === 0 ? (
              <tr>
                <td
                  colSpan={showActions ? 6 : 5}
                  style={{ textAlign: "center", padding: "2rem" }}
                >
                  {serverSearchPending || isLoadingMoreData
                    ? null
                    : "No jobs match your filters."}
                </td>
              </tr>
            ) : (
              visibleJobs.map((job) => (
                <React.Fragment key={job._id}>
                  <tr
                    id={`job-row-${job._id}`}
                    style={{
                      cursor: "pointer",
                      borderBottom:
                        expandedJobId === job._id
                          ? "none"
                          : "1px solid var(--color-border)",
                      // Highlight the row being actively edited
                      ...(editingJobId === job._id && {
                        backgroundColor: "rgba(245, 158, 11, 0.06)",
                        boxShadow: "inset 4px 0 0 var(--color-warning)",
                      }),
                    }}
                    onClick={() => toggleExpand(job._id)}
                  >
                    <td style={{ textAlign: "center" }}>
                      {expandedJobId === job._id ? (
                        <ChevronDown size={20} color="var(--color-primary)" />
                      ) : (
                        <ChevronRight
                          size={20}
                          color="var(--color-text-muted)"
                        />
                      )}
                    </td>
                    <td style={{ fontFamily: "monospace", fontWeight: 600 }}>
                      <span
                        style={{
                          textDecoration:
                            job.status === "CANCELLED"
                              ? "line-through"
                              : "none",
                          opacity: job.status === "CANCELLED" ? 0.5 : 1,
                        }}
                      >
                        {formatJobCode(job.jobCode)}
                      </span>
                      {job.status === "CANCELLED" && (
                        <span
                          style={{
                            marginLeft: "0.5rem",
                            fontSize: "0.7rem",
                            padding: "0.1rem 0.4rem",
                            backgroundColor: "var(--color-danger)",
                            color: "white",
                            borderRadius: "4px",
                          }}
                        >
                          CANCELLED
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        fontWeight: 500,
                        textDecoration:
                          job.status === "CANCELLED" ? "line-through" : "none",
                        opacity: job.status === "CANCELLED" ? 0.5 : 1,
                      }}
                    >
                      {job.clientName}
                    </td>
                    <td
                      style={{
                        textDecoration:
                          job.status === "CANCELLED" ? "line-through" : "none",
                        opacity: job.status === "CANCELLED" ? 0.5 : 1,
                      }}
                    >
                      {formatDate(job.createdAt)}
                    </td>
                    <td
                      style={{ opacity: job.status === "CANCELLED" ? 0.5 : 1 }}
                    >
                      <StatusBadge
                        status={
                          job.status === "ON_HOLD"
                            ? "ON_HOLD"
                            : job.status === "CANCELLED"
                            ? "CANCELLED"
                            : getJobStatus(job)
                        }
                        isLoading={loadingJobId === job._id}
                      />
                    </td>
                    {showActions && (
                      <td
                        style={{
                          textAlign: "right",
                          display: "flex",
                          gap: "0.5rem",
                          justifyContent: "flex-end",
                          alignItems: "center",
                        }}
                      >
                        {getJobStatus(job) === "COMPLETED" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedReportJob(job);
                            }}
                            style={{
                              padding: "0.3rem 0.6rem",
                              fontSize: "0.8rem",
                              background:
                                "linear-gradient(135deg, #7C3AED 0%, #4F46E5 100%)",
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "0.3rem",
                              fontWeight: 600,
                              boxShadow: "0 2px 6px rgba(124, 58, 237, 0.2)",
                              transition: "transform 0.1s",
                            }}
                            title="View & Download Report"
                            onMouseOver={(e) =>
                              (e.currentTarget.style.transform = "scale(1.05)")
                            }
                            onMouseOut={(e) =>
                              (e.currentTarget.style.transform = "scale(1)")
                            }
                          >
                            <FileText size={14} /> Report
                          </button>
                        )}
                        {job.history?.length > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setHistoryJob(job);
                            }}
                            style={{
                              background: editingJobId === job._id
                                ? "rgba(245, 158, 11, 0.15)"
                                : "none",
                              border: editingJobId === job._id
                                ? "1px solid rgba(245, 158, 11, 0.4)"
                                : "none",
                              color: editingJobId === job._id
                                ? "var(--color-warning)"
                                : "var(--color-text-muted)",
                              cursor: "pointer",
                              padding: "0.2rem 0.4rem",
                              borderRadius: "4px",
                              display: "flex",
                              alignItems: "center",
                              transition: "all 0.2s",
                            }}
                            title="View Job History"
                          >
                            <Clock size={16} />
                          </button>
                        )}
                        {onEditJob && getJobStatus(job) !== "COMPLETED" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditJob(job);
                            }}
                            style={{
                              background: editingJobId === job._id
                                ? "rgba(245, 158, 11, 0.15)"
                                : "none",
                              border: editingJobId === job._id
                                ? "1px solid rgba(245, 158, 11, 0.4)"
                                : "none",
                              color: editingJobId === job._id
                                ? "var(--color-warning)"
                                : "var(--color-primary)",
                              cursor: "pointer",
                              padding: "0.2rem 0.4rem",
                              borderRadius: "4px",
                              display: "flex",
                              alignItems: "center",
                              transition: "all 0.2s",
                            }}
                            title={editingJobId === job._id ? "Currently Editing" : "Edit Job"}
                          >
                            <Edit size={16} />
                          </button>
                        )}
                        {onHoldJob && !["ON_HOLD", "COMPLETED", "CANCELLED"].includes(getJobStatus(job)) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onHoldJob(job._id);
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#F59E0B",
                              cursor: "pointer",
                              padding: "0.2rem",
                              display: "flex",
                              alignItems: "center",
                            }}
                            title="Place Job on Hold"
                          >
                            <PauseCircle size={16} />
                          </button>
                        )}
                        {onDeleteJob && !["COMPLETED", "CANCELLED"].includes(getJobStatus(job)) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteJob(job._id);
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--color-danger)",
                              cursor: "pointer",
                              padding: "0.2rem",
                              display: "flex",
                              alignItems: "center",
                            }}
                            title="Cancel Job"
                          >
                            <XCircle size={16} />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {expandedJobId === job._id && (
                    <tr>
                      <td
                        colSpan={showActions ? 6 : 5}
                        style={{
                          padding: "0",
                          backgroundColor: "var(--color-surface-hover)",
                        }}
                      >
                        <div
                          style={{
                            padding: "1.5rem",
                            borderBottom: "1px solid var(--color-border)",
                          }}
                        >
                          <JobTimeline
                            job={job}
                            allJobs={jobs}
                            onReopen={onReopen}
                          />
                          <AssignmentHistory testInstances={job.testInstances} />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* MOBILE CARD VIEW */}
      <div
        className="show-on-mobile-flex"
        style={{
          padding: "1rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
          backgroundColor: "var(--color-surface-hover)",
        }}
      >
        {visibleJobs.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "2rem",
              color: "var(--color-text-muted)",
            }}
          >
            {serverSearchPending || isLoadingMoreData
              ? null
              : "No jobs match your filters."}
          </div>
        ) : (
          visibleJobs.map((job) => (
            <div
              key={`mobile-job-${job._id}`}
              style={{
                backgroundColor: "var(--color-surface)",
                borderRadius: "var(--radius-lg)",
                padding: "1.25rem",
                boxShadow: "var(--shadow-sm)",
                border:
                  editingJobId === job._id
                    ? "2px solid var(--color-warning)"
                    : expandedJobId === job._id
                      ? "2px solid var(--color-primary)"
                      : "1px solid var(--color-border)",
                backgroundColor: editingJobId === job._id
                  ? "rgba(245, 158, 11, 0.04)"
                  : "var(--color-surface)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "0.75rem",
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      fontSize: "1.05rem",
                      color: "var(--color-primary)",
                    }}
                  >
                    {formatJobCode(job.jobCode)}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--color-text-muted)",
                      marginTop: "0.2rem",
                    }}
                  >
                    {formatDate(job.createdAt)}
                  </div>
                </div>
                <StatusBadge 
                  status={
                    job.status === "ON_HOLD" 
                      ? "ON_HOLD" 
                      : job.status === "CANCELLED" 
                        ? "CANCELLED" 
                        : getJobStatus(job)
                  } 
                />
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <div
                  style={{
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--color-text-muted)",
                    marginBottom: "0.2rem",
                  }}
                >
                  Client
                </div>
                <div style={{ fontWeight: 600, fontSize: "1rem" }}>
                  {job.clientName}
                </div>
              </div>

              {showActions && (
                <div
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    flexWrap: "wrap",
                    marginBottom: "1rem",
                    paddingTop: "1rem",
                    borderTop: "1px solid var(--color-border)",
                  }}
                >
                  {getJobStatus(job) === "COMPLETED" && (
                    <button
                      onClick={() => setSelectedReportJob(job)}
                      style={{
                        flex: 1,
                        padding: "0.5rem",
                        fontSize: "0.85rem",
                        background:
                          "linear-gradient(135deg, #7C3AED 0%, #4F46E5 100%)",
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        gap: "0.4rem",
                        fontWeight: 600,
                        boxShadow: "0 2px 6px rgba(124, 58, 237, 0.2)",
                      }}
                    >
                      <FileText size={14} /> Report
                    </button>
                  )}
                  {job.history?.length > 0 && (
                    <button
                      onClick={() => setHistoryJob(job)}
                      style={{
                        padding: "0.5rem",
                        background: editingJobId === job._id
                          ? "rgba(245, 158, 11, 0.15)"
                          : "var(--color-surface-hover)",
                        border: editingJobId === job._id
                          ? "1px solid rgba(245, 158, 11, 0.4)"
                          : "1px solid var(--color-border)",
                        borderRadius: "6px",
                        color: editingJobId === job._id
                          ? "var(--color-warning)"
                          : "var(--color-text-main)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Clock size={16} />
                    </button>
                  )}
                  {onEditJob && getJobStatus(job) !== "COMPLETED" && (
                    <button
                      onClick={() => onEditJob(job)}
                      style={{
                        padding: "0.5rem",
                        background: editingJobId === job._id
                          ? "rgba(245, 158, 11, 0.15)"
                          : "var(--color-surface-hover)",
                        border: editingJobId === job._id
                          ? "1px solid rgba(245, 158, 11, 0.4)"
                          : "1px solid var(--color-border)",
                        borderRadius: "6px",
                        color: editingJobId === job._id
                          ? "var(--color-warning)"
                          : "var(--color-primary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      title={editingJobId === job._id ? "Currently Editing" : "Edit Job"}
                    >
                      <Edit size={16} />
                    </button>
                  )}
                  {onHoldJob && !["ON_HOLD", "COMPLETED", "CANCELLED"].includes(getJobStatus(job)) && (
                    <button
                      onClick={() => onHoldJob(job._id)}
                      style={{
                        padding: "0.5rem",
                        background: "rgba(245, 158, 11, 0.1)",
                        border: "1px solid rgba(245, 158, 11, 0.4)",
                        borderRadius: "6px",
                        color: "#F59E0B",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      title="Place Job on Hold"
                    >
                      <PauseCircle size={16} />
                    </button>
                  )}
                  {onDeleteJob && !["COMPLETED", "CANCELLED"].includes(getJobStatus(job)) && (
                    <button
                      onClick={() => onDeleteJob(job._id)}
                      style={{
                        padding: "0.5rem",
                        background: "var(--color-danger-light)",
                        border: "1px solid var(--color-danger)",
                        borderRadius: "6px",
                        color: "var(--color-danger)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      title="Cancel Job"
                    >
                      <XCircle size={16} />
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={() => toggleExpand(job._id)}
                style={{
                  width: "100%",
                  padding: "0.65rem 0.75rem",
                  background:
                    expandedJobId === job._id
                      ? "var(--color-primary)"
                      : "var(--color-surface-hover)",
                  color:
                    expandedJobId === job._id
                      ? "white"
                      : "var(--color-primary)",
                  border:
                    expandedJobId === job._id
                      ? "none"
                      : "1px solid var(--color-border)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.1rem",
                  fontWeight: 600,
                  transition: "all 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {expandedJobId === job._id ? "Hide Workflow Timeline" : "View Workflow Timeline"}{" "}
                  {expandedJobId === job._id ? (
                    <ChevronUp size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )}
                </div>
                <div style={{ fontSize: "0.72rem", fontWeight: 400, opacity: 0.75 }}>
                  {expandedJobId === job._id ? "" : "Pipeline stages and current status per department"}
                </div>
              </button>

              {expandedJobId === job._id && (
                <div
                  style={{
                    marginTop: "1rem",
                    paddingTop: "1rem",
                    borderTop: "1px dashed var(--color-border)",
                    margin: "1rem -1.25rem -1.25rem -1.25rem",
                    padding: "1rem 0.5rem 0.5rem 0.5rem",
                    backgroundColor: "#F9FAFB",
                    borderBottomLeftRadius: "var(--radius-lg)",
                    borderBottomRightRadius: "var(--radius-lg)",
                  }}
                >
                  <JobTimeline job={job} allJobs={jobs} onReopen={onReopen} />
                  <AssignmentHistory testInstances={job.testInstances} />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <InfiniteScroll 
        hasMore={page < totalPages || hasMoreData} 
        isLoading={isLoadingMoreData || false} 
        onLoadMore={handleLoadMore} 
      />

      {historyJob && (
        <GlobalJobHistory
          job={historyJob}
          onClose={() => setHistoryJob(null)}
        />
      )}
      {selectedReportJob && (
        <ReportModal
          job={selectedReportJob}
          onClose={() => setSelectedReportJob(null)}
        />
      )}
    </div>
  );
}
