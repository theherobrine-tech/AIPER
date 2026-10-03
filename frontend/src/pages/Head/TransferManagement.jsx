import React, { useState, useEffect, useContext } from "react";
import axios from "axios";
import { ArrowRightLeft, PackageOpen, AlertCircle, Check, Send, PackageCheck, CheckCircle, ChevronDown, ChevronRight } from "lucide-react";
import API_URL from "../../utils/api";
import Spinner from "../../components/Spinner";
import { formatJobCode } from "../../utils/serialUtils";
import { useSocket } from "../../context/SocketContext";
import { AuthContext } from "../../context/AuthContext";
import { fetchWithCache, invalidateCache, CACHE_KEYS, isCached } from "../../utils/cache";
import { formatDateTime } from "../../utils/dateUtils";

export default function TransferManagement() {
  const [incomingTransfers, setIncomingTransfers] = useState([]);
  const [outgoingJobs, setOutgoingJobs] = useState([]);
  const [transferListLoading, setTransferListLoading] = useState(
    () => !isCached(CACHE_KEYS.TRANSFERS_IN) || !isCached(CACHE_KEYS.TRANSFERS_OUT)
  );
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferConfirmData, setTransferConfirmData] = useState(null);
  const [success, setSuccess] = useState("");
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  const { user } = useContext(AuthContext);
  
  const socket = useSocket();

  const fetchTransfers = async () => {
    try {
      const p1 = fetchWithCache(
        `${API_URL}/api/sample-transfers/incoming`,
        CACHE_KEYS.TRANSFERS_IN,
        setIncomingTransfers,
        { Authorization: `Bearer ${localStorage.getItem("token")}` },
      );
      const p2 = fetchWithCache(
        `${API_URL}/api/sample-transfers/outgoing`,
        CACHE_KEYS.TRANSFERS_OUT,
        setOutgoingJobs,
        { Authorization: `Bearer ${localStorage.getItem("token")}` },
      );
      await Promise.all([p1, p2]);
    } catch (err) {
      console.error("Error fetching transfers:", err);
    } finally {
      setTransferListLoading(false);
    }
  };

  useEffect(() => {
    fetchTransfers();
  }, []);

  useEffect(() => {
    if (!socket) return;
    const updateTransfers = () => {
      invalidateCache(CACHE_KEYS.TRANSFERS_IN, CACHE_KEYS.TRANSFERS_OUT);
      fetchTransfers();
    };
    socket.on("TRANSFER_INITIATED", updateTransfers);
    socket.on("TRANSFER_RECEIVED", updateTransfers);
    return () => {
      socket.off("TRANSFER_INITIATED", updateTransfers);
      socket.off("TRANSFER_RECEIVED", updateTransfers);
    };
  }, [socket]);

  const handleSendTransferClick = (jobId) => {
    setTransferConfirmData({
      type: "send",
      id: jobId,
      title: "Hand Over Sample",
      message:
        "You are handing over this sample to the other department. This action will be recorded and cannot be undone.",
    });
  };

  const handleReceiveTransferClick = (transferId) => {
    setTransferConfirmData({
      type: "receive",
      id: transferId,
      title: "Confirm Receipt",
      message:
        "You are confirming receipt of this sample. The job will become available in your dispatcher.",
    });
  };

  const executeTransfer = async () => {
    if (!transferConfirmData || transferLoading) return;
    const { type, id } = transferConfirmData;
    setTransferLoading(true);

    try {
      if (type === "send") {
        await axios.post(
          `${API_URL}/api/sample-transfers`,
          { jobId: id },
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          },
        );
        setSuccess(
          "Sample hand-over recorded! The other department has been notified.",
        );
        setOutgoingJobs((prev) => prev.filter((j) => j._id !== id));
      } else if (type === "receive") {
        await axios.put(
          `${API_URL}/api/sample-transfers/${id}/receive`,
          {},
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          },
        );

        // Immediately remove from UI for snappy experience
        setIncomingTransfers((prev) => prev.filter((t) => t._id !== id));

        setSuccess(
          "Sample receipt confirmed! The job is now available in your dispatcher.",
        );
        invalidateCache(CACHE_KEYS.JOBS);
      }
      setTimeout(() => setSuccess(""), 4000);
      fetchTransfers();
      setTransferConfirmData(null);
    } catch (err) {
      alert(
        err.response?.data?.message ||
        `Error ${type === "send" ? "sending" : "receiving"} transfer`,
      );
    } finally {
      setTransferLoading(false);
    }
  };

  const totalTransfersCount = incomingTransfers.length + outgoingJobs.length;

  const renderAccordionBody = () => {
    if (transferListLoading && incomingTransfers.length === 0 && outgoingJobs.length === 0) {
      return <Spinner message="Loading transfers..." />;
    }
    return (
      <>
        {/* Incoming */}
        {incomingTransfers.length > 0 && (
          <div style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--color-warning)" }}>
              <PackageCheck size={20} /> Incoming Samples - Action Required
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {incomingTransfers.map((transfer) => (
                <div
                  key={transfer._id}
                  className="card"
                  style={{ padding: "1.25rem 1.5rem", border: "2px solid var(--color-warning)", backgroundColor: "rgba(241, 196, 15, 0.05)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.3rem" }}>
                      Sample from {transfer.fromDepartment === "micro" ? "Micro" : "Chemical"} Department
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
                      Sample Serial: <strong>#{transfer.sampleSerial}</strong>
                      {transfer.jobId?.clientName && ` · ${transfer.jobId.clientName}`}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "0.2rem" }}>
                      Sent by: {transfer.sentBy?.name || "Unknown"} · {formatDateTime(transfer.sentAt)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleReceiveTransferClick(transfer._id)}
                    disabled={transferLoading}
                    className="btn btn-primary"
                    style={{ padding: "0.6rem 1.2rem", display: "flex", alignItems: "center", gap: "0.4rem" }}
                  >
                    <Check size={16} /> {transferLoading ? "Processing..." : "Confirm Receipt"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Outgoing */}
        {outgoingJobs.length > 0 && (
          <div style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--color-primary)" }}>
              <Send size={20} /> Samples Ready for Hand-Over
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {outgoingJobs.map((job) => {
                const secondDept = user?.department?.toLowerCase() === "micro" ? "Chemical" : "Micro";
                return (
                  <div
                    key={job._id}
                    className="card"
                    style={{ padding: "1.25rem 1.5rem", border: "2px solid var(--color-primary)", backgroundColor: "rgba(52, 152, 219, 0.05)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.3rem" }}>
                        Hand Over to {secondDept} Department
                      </div>
                      <div style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
                        Sample Serial: <strong>#{job.sampleSerial}</strong>{" "}
                        {job.clientName ? `- ${job.clientName}` : ""}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "0.2rem" }}>
                        Please hand over the sample to the {secondDept} department once you have taken your required portion.
                      </div>
                    </div>
                    <button
                      onClick={() => handleSendTransferClick(job._id)}
                      disabled={transferLoading}
                      className="btn"
                      style={{ padding: "0.6rem 1.2rem", display: "flex", alignItems: "center", gap: "0.4rem", backgroundColor: "var(--color-primary)", color: "white" }}
                    >
                      <ArrowRightLeft size={16} /> {transferLoading ? "Processing..." : "Hand Over Sample"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <>
      {totalTransfersCount > 0 && (
        <div style={{ marginBottom: "2.5rem" }}>
          {/* Accordion toggle */}
          <div
            onClick={() => setIsAccordionOpen(!isAccordionOpen)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
              padding: "1rem",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: isAccordionOpen ? "var(--radius-lg) var(--radius-lg) 0 0" : "var(--radius-lg)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <h1 style={{ fontSize: "1.2rem", fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--color-text-main)" }}>
              <ArrowRightLeft size={20} /> Sample Transfer Management
              <span style={{ background: "var(--color-danger)", color: "white", borderRadius: "50%", width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: "bold", marginLeft: "0.5rem" }}>
                {totalTransfersCount}
              </span>
            </h1>
            {isAccordionOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
          </div>

          {/* Accordion body */}
          {isAccordionOpen && (
            <div style={{ padding: "1.5rem", border: "1px solid var(--color-border)", borderTop: "none", borderRadius: "0 0 var(--radius-lg) var(--radius-lg)", background: "var(--color-surface)" }}>
              {renderAccordionBody()}
            </div>
          )}
        </div>
      )}

      {/* Confirmation modal */}
      {transferConfirmData && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: "400px", textAlign: "center" }}>
            <h3 style={{ margin: "0 0 1rem 0", color: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
              <AlertCircle size={24} /> {transferConfirmData.title}
            </h3>
            <p style={{ marginBottom: "2rem" }}>{transferConfirmData.message}</p>
            <div className="form-actions" style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
              <button className="btn btn-secondary" onClick={() => setTransferConfirmData(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => executeTransfer()} disabled={transferLoading}>
                {transferLoading ? "Processing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
