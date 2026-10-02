import React, { useState, useEffect, useContext } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchWithCache, invalidateCache, CACHE_KEYS, isCached } from "../../utils/cache";
import { cacheGet, cacheSet } from "../../utils/cacheStorage";
import { formatDate, formatDateTime } from "../../utils/dateUtils";
import API_URL from "../../utils/api";
import Spinner from "../../components/Spinner";

import { 
  Play, Plus, Check, Clock, Edit, FileText, XCircle, Search, LogOut, ChevronDown, 
  ChevronRight, ArrowLeft, Download, Eye, LayoutDashboard, Users, Activity as ActivityIcon, RefreshCw, X, Shield,
  ClipboardCheck, CheckCircle, RotateCcw } from "lucide-react";
import { useSocket } from "../../context/SocketContext";
import { AuthContext } from "../../context/AuthContext";
import { formatJobCode } from "../../utils/serialUtils";

export default function ReviewQueue() {
  const { user } = useContext(AuthContext);
  const [instances, setInstances] = useState([]);
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [reassignNote, setReassignNote] = useState("");
  const [showReassignForm, setShowReassignForm] = useState(null); // instance._id when reassign mode is active
  const [success, setSuccess] = useState("");
  const [reviewLoading, setReviewLoading] = useState(
    () => !isCached(CACHE_KEYS.INSTANCES),
  );
  const [assistants, setAssistants] = useState([]);
  const [submittingReviewId, setSubmittingReviewId] = useState(null);

  // Selective reassignment state: { [parameterId]: { selected: bool, assignedTo: userId } }
  const [paramSelections, setParamSelections] = useState({});

  const fetchReviewItems = async () => {
    try {
      await fetchWithCache(
        `${API_URL}/api/tests/instances`,
        CACHE_KEYS.INSTANCES,
        (data) =>
          setInstances(data.filter((i) => i.status === "PENDING_HEAD_REVIEW")),
      );
    } catch (err) {
      console.error(err);
    } finally {
      setReviewLoading(false);
    }
  };

  useEffect(() => {
    fetchReviewItems();
    // Fetch assistants in this department for the analyst dropdown
    fetchWithCache(`${API_URL}/api/users`, CACHE_KEYS.USERS, (data) =>
      setAssistants(
        data.filter(
          (u) => u.role === "ASSISTANT" && u.department === user?.department,
        ),
      ),
    ).catch(console.error);
  }, []);

  const socket = useSocket();

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      invalidateCache(CACHE_KEYS.INSTANCES, CACHE_KEYS.JOBS, CACHE_KEYS.STATS);
      fetchReviewItems();
    };

    socket.on("TEST_SUBMITTED", refresh);
    socket.on("TEST_REVIEWED", refresh);
    socket.on("JOB_HELD", refresh);
    socket.on("JOB_UPDATED", refresh);

    return () => {
      socket.off("TEST_SUBMITTED", refresh);
      socket.off("TEST_REVIEWED", refresh);
      socket.off("JOB_HELD", refresh);
      socket.off("JOB_UPDATED", refresh);
    };
  }, [socket]);

  const handleApprove = async (id) => {
    setSubmittingReviewId(id);
    try {
      await axios.put(`${API_URL}/api/tests/instances/${id}/review`, {
        action: "APPROVE",
      });
      setSuccess("Approved and Completed. Report Generated.");
      invalidateCache(CACHE_KEYS.INSTANCES, CACHE_KEYS.JOBS, CACHE_KEYS.STATS);
      fetchReviewItems();
      setSelectedInstance(null);
      setTimeout(() => setSuccess(""), 4000);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingReviewId(null);
    }
  };

  const enterReassignMode = (inst) => {
    setShowReassignForm(inst._id);
    const selections = {};
    inst.results.forEach((r) => {
      if (r.isPanel && r.panelName) {
        const pKey = `panel-${r.panelName.toLowerCase()}`;
        if (!selections[pKey]) {
          selections[pKey] = {
            selected: false,
            assignedTo:
              r.assignedTo || inst.assignedTo?._id || inst.assignedTo || "",
          };
        }
      } else {
        selections[r.parameterId] = {
          selected: false,
          assignedTo:
            r.assignedTo || inst.assignedTo?._id || inst.assignedTo || "",
        };
      }
    });
    setParamSelections(selections);
    setReassignNote("");
  };

  const exitReassignMode = () => {
    setShowReassignForm(null);
    setParamSelections({});
    setReassignNote("");
  };

  const toggleParamSelection = (parameterId) => {
    setParamSelections((prev) => ({
      ...prev,
      [parameterId]: {
        ...prev[parameterId],
        selected: !prev[parameterId]?.selected,
      },
    }));
  };

  const changeParamAnalyst = (parameterId, analystId) => {
    setParamSelections((prev) => ({
      ...prev,
      [parameterId]: {
        ...prev[parameterId],
        assignedTo: analystId,
      },
    }));
  };

  const handleReassign = async (id) => {
    const inst = instances.find((j) => j._id === id);
    if (!inst) return;

    const selected = [];
    Object.entries(paramSelections).forEach(([key, v]) => {
      if (v.selected) {
        if (key.startsWith("panel-")) {
          const panelName = key.replace("panel-", "").toUpperCase();
          inst.results.forEach((r) => {
            if (r.isPanel && r.panelName === panelName) {
              selected.push({
                parameterId: r.parameterId,
                assignedTo: v.assignedTo,
              });
            }
          });
        } else {
          selected.push({ parameterId: key, assignedTo: v.assignedTo });
        }
      }
    });

    if (selected.length === 0) {
      return alert("Please select at least one parameter to reassign.");
    }

    setSubmittingReviewId(id);
    try {
      await axios.put(`${API_URL}/api/tests/instances/${id}/review`, {
        action: "REASSIGN",
        note: reassignNote,
        selectedParams: selected,
      });
      setSuccess(`Sent ${selected.length} parameter(s) for retest.`);
      exitReassignMode();
      invalidateCache(CACHE_KEYS.INSTANCES, CACHE_KEYS.JOBS, CACHE_KEYS.STATS);
      fetchReviewItems();
      setSelectedInstance(null);
      setTimeout(() => setSuccess(""), 4000);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingReviewId(null);
    }
  };

  const selectedCount = Object.values(paramSelections).filter(
    (v) => v.selected,
  ).length;

  return (
    <div>
      <h1
        style={{
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <ClipboardCheck size={28} style={{ color: "var(--color-primary)" }} />{" "}
        Review Queue
      </h1>

      {success && (
        <div
          style={{
            position: "fixed",
            top: "6rem",
            right: "2rem",
            zIndex: 1000,
            color: "white",
            backgroundColor: "var(--color-success)",
            padding: "1rem 1.5rem",
            borderRadius: "var(--radius-md)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            animation: "slideIn 0.3s ease-out",
          }}
        >
          <CheckCircle size={20} />
          <span style={{ fontWeight: 500 }}>{success}</span>
        </div>
      )}

      {reviewLoading && instances.length === 0 ? (
        <div className="card">
          <Spinner message="Loading review queue..." />
        </div>
      ) : instances.length === 0 ? (
        <div
          className="card"
          style={{
            textAlign: "center",
            padding: "3rem",
            color: "var(--color-text-muted)",
          }}
        >
          No submissions awaiting your review.
        </div>
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}
        >
          {instances.map((inst) => {
            const isReassignMode = showReassignForm === inst._id;

            return (
              <div
                key={inst._id}
                className="card"
                style={{
                  borderLeft: `4px solid ${isReassignMode ? "var(--color-danger)" : "var(--color-warning)"}`,
                  padding: 0,
                  overflow: "hidden",
                  transition: "border-color 0.2s",
                }}
              >
                {/* Header */}
                <div
                  style={{
                    padding: "1.25rem 1.5rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderBottom: "1px solid var(--color-border)",
                    cursor: "pointer",
                    backgroundColor:
                      selectedInstance === inst._id
                        ? "var(--color-surface-hover)"
                        : "transparent",
                  }}
                  onClick={() =>
                    setSelectedInstance(
                      selectedInstance === inst._id ? null : inst._id,
                    )
                  }
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "1.05rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontFamily: "monospace", color: "var(--color-primary-dark)" }}>
                        {formatJobCode(inst.testCode)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "var(--color-text-muted)",
                        marginTop: "0.3rem",
                      }}
                    >
                      Analyst: {inst.assignedTo?.name} · Client: {inst.clientName}
                    </div>
                  </div>
                  <span className="badge badge-warning">Awaiting Review</span>
                </div>

                {/* Expanded detail */}
                {selectedInstance === inst._id && (
                  <div style={{ padding: "1.5rem" }}>
                    {/* Review history */}
                    {inst.reviewHistory && inst.reviewHistory.length > 0 && (
                      <div
                        style={{
                          marginBottom: "1.5rem",
                          padding: "1rem",
                          backgroundColor: "rgba(241, 196, 15, 0.05)",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--color-warning)",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            marginBottom: "0.5rem",
                            fontSize: "0.85rem",
                            color: "var(--color-warning)",
                          }}
                        >
                          Previous Review History
                        </div>
                        {inst.reviewHistory.map((rh, i) => {
                          const ACTION_LABELS = {
                            REASSIGN: 'Reassigned to Analyst',
                            REASSIGN_MERGED: 'Parameters added via reassign:',
                            APPROVE: 'Approved',
                            REJECT: 'Rejected',
                          };
                          const label = ACTION_LABELS[rh.action] || rh.action;
                          const isMerged = rh.action === 'REASSIGN_MERGED';
                          return (
                            <div
                              key={i}
                              style={{
                                fontSize: "0.8rem",
                                color: "var(--color-text-muted)",
                                marginBottom: "0.3rem",
                              }}
                            >
                              <strong>{rh.role}</strong>{" "}
                              <span style={{ color: "var(--color-text)" }}>{label}</span>{" "}
                              {rh.note && (
                                <span style={{ fontStyle: isMerged ? "normal" : "italic" }}>
                                  {isMerged ? rh.note : `\u2014 ${rh.note}`}
                                </span>
                              )}{" "}
                              {formatDateTime(rh.date)}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Sample Description (read-only) */}
                    {inst.sampleDescription && (
                      <div style={{
                        marginBottom: '1rem',
                        padding: '0.75rem 1rem',
                        backgroundColor: 'var(--color-surface-hover)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        fontSize: '0.875rem'
                      }}>
                        <div style={{ fontWeight: 600, marginBottom: '0.35rem', color: 'var(--color-text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Sample Description
                        </div>
                        <div style={{ color: 'var(--color-text-main)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                          {inst.sampleDescription}
                        </div>
                      </div>
                    )}

                    {/* Testing Period */}
                    {inst.testingPeriod && inst.testingPeriod.startDate && (
                      <div
                        style={{
                          marginBottom: "1rem",
                          padding: "0.75rem",
                          backgroundColor: "var(--color-surface-hover)",
                          borderRadius: "var(--radius-md)",
                          fontSize: "0.85rem",
                        }}
                      >
                        <strong>Testing Period:</strong>{" "}
                        {formatDate(inst.testingPeriod.startDate)}{" "}
                        to{" "}
                        {formatDate(inst.testingPeriod.endDate)}
                      </div>
                    )}

                    {/* Reassign mode info banner */}
                    {isReassignMode && (
                      <div
                        style={{
                          marginBottom: "1rem",
                          padding: "0.75rem 1rem",
                          backgroundColor: "rgba(231, 76, 60, 0.06)",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--color-danger)",
                          fontSize: "0.85rem",
                          color: "var(--color-danger)",
                          fontWeight: 500,
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <RotateCcw size={16} />
                        Select the parameters that need retesting. You can
                        assign each to a different analyst.
                        {selectedCount > 0 && (
                          <span style={{ marginLeft: "auto", fontWeight: 700 }}>
                            {selectedCount} selected
                          </span>
                        )}
                      </div>
                    )}

                    {/* Results table */}
                    <h4 style={{ marginBottom: "0.75rem" }}>
                      Submitted Results
                    </h4>
                    <div className="table-scroll">
                      <table style={{ marginBottom: "1.5rem" }}>
                        <thead
                          style={{
                            backgroundColor: "var(--color-surface-hover)",
                          }}
                        >
                          <tr>
                            {isReassignMode && (
                              <th
                                style={{ width: "40px", textAlign: "center" }}
                              ></th>
                            )}
                            <th>Parameter</th>
                            <th>Value</th>
                            <th>Unit</th>
                            <th>Test Method</th>
                            <th>Specification</th>
                            {isReassignMode && <th>Assign To</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const displayResults = [];
                            const panelGroups = {};
                            inst.results.forEach((r) => {
                              if (r.isPanel && r.panelName) {
                                if (!panelGroups[r.panelName]) {
                                  panelGroups[r.panelName] = {
                                    parameterId: `panel-${r.panelName.toLowerCase()}`,
                                    name: `Pesticide Panel (${r.panelName})`,
                                    value: "Multiple",
                                    unit: "mg/kg",
                                    testMethod: "N/A",
                                    specification: "",
                                    isPanelGroup: true,
                                  };
                                  displayResults.push(panelGroups[r.panelName]);
                                }
                              } else {
                                displayResults.push(r);
                              }
                            });
                            return displayResults.map((r) => {
                              const sel = paramSelections[r.parameterId];
                              const isSelected = sel?.selected;

                              return (
                                <tr
                                  key={r.parameterId}
                                  onClick={
                                    isReassignMode
                                      ? () =>
                                        toggleParamSelection(r.parameterId)
                                      : undefined
                                  }
                                  style={{
                                    cursor: isReassignMode
                                      ? "pointer"
                                      : "default",
                                    backgroundColor: isSelected
                                      ? "rgba(231, 76, 60, 0.06)"
                                      : "transparent",
                                    transition: "background-color 0.15s",
                                  }}
                                >
                                  {isReassignMode && (
                                    <td style={{ textAlign: "center" }}>
                                      <input
                                        type="checkbox"
                                        checked={!!isSelected}
                                        onChange={() =>
                                          toggleParamSelection(r.parameterId)
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        style={{
                                          width: "16px",
                                          height: "16px",
                                          accentColor: "var(--color-danger)",
                                          cursor: "pointer",
                                        }}
                                      />
                                    </td>
                                  )}
                                  <td style={{ fontWeight: 500 }}>
                                    {r.name}
                                    {r.isPanelGroup && (
                                      <span
                                        style={{
                                          marginLeft: "0.5rem",
                                          fontSize: "0.7rem",
                                          padding: "0.1rem 0.3rem",
                                          backgroundColor: "#e0e7ff",
                                          color: "#3730a3",
                                          borderRadius: "4px",
                                        }}
                                      >
                                        PANEL
                                      </span>
                                    )}
                                  </td>
                                  <td
                                    style={{
                                      fontFamily: "monospace",
                                      fontWeight: 600,
                                      color: isSelected
                                        ? "var(--color-danger)"
                                        : "var(--color-primary)",
                                    }}
                                  >
                                    {r.value || "—"}
                                  </td>
                                  <td>{r.unit}</td>
                                  <td style={{ fontSize: "0.85rem" }}>
                                    {r.testMethod || "N/A"}
                                  </td>
                                  <td style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
                                    {r.isPanelGroup ? "" : (r.specification || "")}
                                  </td>
                                  {isReassignMode && (
                                    <td onClick={(e) => e.stopPropagation()}>
                                      {isSelected ? (
                                        <select
                                          value={sel?.assignedTo || ""}
                                          onChange={(e) =>
                                            changeParamAnalyst(
                                              r.parameterId,
                                              e.target.value,
                                            )
                                          }
                                          style={{
                                            minWidth: "140px",
                                            fontSize: "0.85rem",
                                          }}
                                        >
                                          <option value="" disabled>
                                            Select Analyst...
                                          </option>
                                          {assistants.map((a) => (
                                            <option key={a._id} value={a._id}>
                                              {a.name}
                                            </option>
                                          ))}
                                        </select>
                                      ) : (
                                        <span
                                          style={{
                                            fontSize: "0.8rem",
                                            color: "var(--color-text-muted)",
                                          }}
                                        >
                                          —
                                        </span>
                                      )}
                                    </td>
                                  )}
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>

                    {/* Actions */}
                    {isReassignMode ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "1rem",
                        }}
                      >
                        <div>
                          <label
                            style={{
                              display: "block",
                              fontWeight: 500,
                              marginBottom: "0.4rem",
                              fontSize: "0.9rem",
                            }}
                          >
                            Reason for Reassignment
                          </label>
                          <textarea
                            value={reassignNote}
                            onChange={(e) => setReassignNote(e.target.value)}
                            placeholder="Describe what needs to be corrected..."
                            style={{
                              width: "100%",
                              minHeight: "80px",
                              padding: "0.75rem",
                              border: "1px solid var(--color-border)",
                              borderRadius: "var(--radius-md)",
                              resize: "vertical",
                              fontFamily: "inherit",
                            }}
                          />
                        </div>
                        <div className="flex-row-responsive">
                          <button
                            onClick={() => handleReassign(inst._id)}
                            className="btn"
                            disabled={
                              selectedCount === 0 ||
                              submittingReviewId === inst._id
                            }
                            style={{
                              backgroundColor:
                                selectedCount > 0
                                  ? "var(--color-danger)"
                                  : "var(--color-border)",
                              color: "white",
                              border: "none",
                              opacity:
                                selectedCount === 0 ||
                                  submittingReviewId === inst._id
                                  ? 0.5
                                  : 1,
                            }}
                          >
                            {submittingReviewId === inst._id ? (
                              <Spinner
                                size="sm"
                                message="Reassigning..."
                                color="#fff"
                              />
                            ) : (
                              <>
                                <RotateCcw
                                  size={16}
                                  style={{ marginRight: "0.5rem" }}
                                />{" "}
                                Reassign {selectedCount} Parameter
                                {selectedCount !== 1 ? "s" : ""}
                              </>
                            )}
                          </button>
                          <button
                            onClick={exitReassignMode}
                            className="btn"
                            style={{
                              border: "1px solid var(--color-border)",
                              backgroundColor: "transparent",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: "1rem" }}>
                        <button
                          onClick={() => handleApprove(inst._id)}
                          disabled={submittingReviewId === inst._id}
                          className="btn btn-success"
                          style={{ flex: 1, justifyContent: "center" }}
                        >
                          {submittingReviewId === inst._id ? (
                            <Spinner
                              size="sm"
                              message="Processing..."
                              color="#fff"
                            />
                          ) : (
                            <>
                              <CheckCircle
                                size={16}
                                style={{ marginRight: "0.5rem" }}
                              />{" "}
                              Approve & Complete
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => enterReassignMode(inst)}
                          className="btn"
                          style={{
                            flex: 1,
                            justifyContent: "center",
                            backgroundColor: "var(--color-warning)",
                            color: "white",
                            border: "none",
                          }}
                        >
                          <RotateCcw
                            size={16}
                            style={{ marginRight: "0.5rem" }}
                          />{" "}
                          Reassign to Analyst
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
