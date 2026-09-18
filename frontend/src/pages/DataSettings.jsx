import React, { useState, useEffect, useRef } from "react";
import { Database, Settings, Hash, Download, ShieldCheck, Clock, CheckCircle } from "lucide-react";
import GroupSettings from "./Settings/GroupSettings";
import SerialSettings from "./Settings/SerialSettings";
import { formatDateTime } from "../utils/dateUtils";
import API_URL from "../utils/api";
import axios from "axios";

const BACKUP_STORAGE_KEY = "ftl_last_backup_timestamp";

export default function DataSettings() {
  const [activeTab, setActiveTab] = useState("groups");

  // Backup state machine: 'idle' | 'fetching' | 'animating' | 'done'
  const [backupPhase, setBackupPhase] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [lastBackup, setLastBackup] = useState(() => {
    // Prefer DB-sourced value from user object, fall back to legacy localStorage key
    const storedUser = JSON.parse(localStorage.getItem("user") || "null");
    return storedUser?.lastBackupAt || localStorage.getItem(BACKUP_STORAGE_KEY) || null;
  });
  const blobRef = useRef(null);
  const filenameRef = useRef("FTL_LIMS_backup.json");

  // Animate progress bar from 0 → 100 over ~2.5s once data is ready
  useEffect(() => {
    if (backupPhase !== "animating") return;
    let frame;
    let start = null;
    const duration = 2500; // ms

    const tick = (ts) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setProgress(pct);
      if (pct < 100) {
        frame = requestAnimationFrame(tick);
      } else {
        // Done animating — trigger download and mark done
        triggerDownload();
        const now = new Date().toISOString();
        localStorage.setItem(BACKUP_STORAGE_KEY, now);
        setLastBackup(now);
        setBackupPhase("done");
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [backupPhase]);

  // Auto-reset to idle after 5s in done phase
  useEffect(() => {
    if (backupPhase !== "done") return;
    const timer = setTimeout(() => {
      setBackupPhase("idle");
      setProgress(0);
    }, 5000);
    return () => clearTimeout(timer);
  }, [backupPhase]);

  const triggerDownload = () => {
    if (!blobRef.current) return;
    const url = window.URL.createObjectURL(blobRef.current);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filenameRef.current);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    blobRef.current = null;
  };

  const handleBackup = async () => {
    setBackupPhase("fetching");
    setProgress(0);
    try {
      const response = await axios.get(`${API_URL}/api/export/db-backup`, {
        responseType: "blob",
      });

      // Extract filename
      const disposition = response.headers["content-disposition"] || "";
      const match = disposition.match(/filename="([^"]+)"/);
      filenameRef.current = match ? match[1] : "FTL_LIMS_backup.json";
      blobRef.current = new Blob([response.data]);

      // Update lastBackupAt — from DB-stamped header, persisted into user object
      const backupTs = response.headers["x-backup-timestamp"] || new Date().toISOString();
      setLastBackup(backupTs);
      // Persist into the stored user object so it survives re-login reads
      const storedUser = JSON.parse(localStorage.getItem("user") || "null");
      if (storedUser) {
        storedUser.lastBackupAt = backupTs;
        localStorage.setItem("user", JSON.stringify(storedUser));
      }
      // Legacy key for backward compat
      localStorage.setItem(BACKUP_STORAGE_KEY, backupTs);

      // Data is ready — start the aesthetic progress animation
      setBackupPhase("animating");
    } catch (err) {
      console.error("Backup failed:", err);
      alert("Backup failed. Please try again.");
      setBackupPhase("idle");
      setProgress(0);
    }
  };

  const resetBackup = () => {
    setBackupPhase("idle");
    setProgress(0);
  };

  const isRunning = backupPhase === "fetching" || backupPhase === "animating";

  return (
    <div style={{ paddingBottom: "3rem" }}>
      <h1
        style={{
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <Database size={28} style={{ color: "var(--color-primary)" }} /> Data Settings
      </h1>

      {/* Tabs — backup button pushed to the right */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: "2rem",
          borderBottom: "1px solid var(--color-border)",
          paddingBottom: "0.5rem",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <button
          className={`btn ${activeTab === "groups" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("groups")}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          <Settings size={18} /> Parameter Groups
        </button>
        <button
          className={`btn ${activeTab === "serial" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("serial")}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          <Hash size={18} /> Sample Serial (Job Code)
        </button>

        {/* Spacer pushes backup button to the right */}
        <div style={{ flex: 1 }} />

        <button
          onClick={() => setActiveTab("backup")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 1rem",
            borderRadius: "6px",
            border: activeTab === "backup" ? "1.5px solid var(--color-success)" : "1.5px dashed var(--color-success)",
            background: activeTab === "backup" ? "var(--color-success)" : "var(--color-success-light)",
            color: activeTab === "backup" ? "#fff" : "var(--color-success)",
            fontWeight: 600,
            fontSize: "0.875rem",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          <ShieldCheck size={18} /> Backup & Export
        </button>
      </div>

      {activeTab === "groups" && <GroupSettings />}
      {activeTab === "serial" && <SerialSettings />}
      {activeTab === "backup" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "3rem 0 3rem",
            textAlign: "center",
          }}
        >
          {/* Icon — always the same */}
          <div
            style={{
              width: "72px",
              height: "72px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #E0F2FE, #DBEAFE)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "1.5rem",
            }}
          >
            <ShieldCheck size={36} style={{ color: "var(--color-primary)" }} />
          </div>

          {/* Title */}
          <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.5rem", fontWeight: 700, color: "var(--color-text-main)" }}>
            Database Backup
          </h2>

          {/* Description */}
          <p
            style={{
              color: "var(--color-text-muted)",
              fontSize: "1rem",
              lineHeight: 1.6,
              margin: "0 0 2rem 0",
              maxWidth: "480px",
            }}
          >
            Downloads all data from the system as a single file.
          </p>

          {/* Last backup hint */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "1.25rem",
              fontSize: "0.9rem",
              color: lastBackup ? "var(--color-text-muted)" : "var(--color-danger, #e74c3c)",
              fontStyle: lastBackup ? "normal" : "italic",
            }}
          >
            <Clock size={16} />
            {lastBackup
              ? `Last backup: ${formatDateTime(lastBackup)}`
              : "No backup has been taken yet"}
          </div>

          {/* Backup button — always visible */}
          <button
            onClick={handleBackup}
            disabled={isRunning}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
              padding: "0.85rem 2.5rem",
              borderRadius: "8px",
              border: "none",
              background: isRunning ? "var(--color-primary-light)" : "var(--color-primary)",
              color: "#fff",
              fontWeight: 600,
              fontSize: "1.05rem",
              cursor: isRunning ? "not-allowed" : "pointer",
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
              boxShadow: "0 2px 8px rgba(44, 62, 80, 0.18)",
              opacity: isRunning ? 0.7 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isRunning) {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 4px 14px rgba(44, 62, 80, 0.25)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 2px 8px rgba(44, 62, 80, 0.18)";
            }}
          >
            {backupPhase === "fetching" ? (
              <>
                <span
                  style={{
                    width: "18px",
                    height: "18px",
                    border: "2.5px solid rgba(255,255,255,0.4)",
                    borderTopColor: "#fff",
                    borderRadius: "50%",
                    display: "inline-block",
                    animation: "spin 0.7s linear infinite",
                  }}
                />
                Preparing…
              </>
            ) : (
              <>
                <Download size={20} /> Backup Data
              </>
            )}
          </button>

          {/* Progress bar area — full page width, below button */}
          {(backupPhase === "animating" || backupPhase === "done") && (
            <div
              style={{
                width: "100%",
                marginTop: "2.5rem",
              }}
            >
              {/* Bar track — full width */}
              <div
                style={{
                  width: "100%",
                  height: "12px",
                  borderRadius: "999px",
                  background: "var(--color-border)",
                  overflow: "hidden",
                  animation: backupPhase === "done" ? "fadeOutDelayed 5s ease forwards" : undefined,
                }}
              >
                <div
                  style={{
                    width: backupPhase === "done" ? "100%" : `${progress}%`,
                    height: "100%",
                    borderRadius: "999px",
                    background: "linear-gradient(90deg, #10B981, #34D399)",
                    transition: "width 0.08s linear",
                  }}
                />
              </div>

              {/* Below bar: percentage or success text */}
              {backupPhase === "animating" && (
                <div style={{ marginTop: "0.75rem", fontSize: "0.9rem", color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                  {progress}%
                </div>
              )}
              {backupPhase === "done" && (
                <div style={{ marginTop: "1rem", animation: "fadeInThenOut 5s ease forwards" }}>
                  <div
                    style={{
                      fontSize: "1.15rem",
                      fontWeight: 700,
                      color: "var(--color-success)",
                      marginBottom: "0.3rem",
                    }}
                  >
                    Data backed up!
                  </div>
                  <div
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--color-text-muted)",
                      opacity: 0.7,
                      fontStyle: "italic",
                    }}
                  >
                    Download started
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* fadeIn animation */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInThenOut {
          0% { opacity: 0; transform: translateY(6px); }
          10% { opacity: 1; transform: translateY(0); }
          70% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes fadeOutDelayed {
          0% { opacity: 1; }
          70% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
