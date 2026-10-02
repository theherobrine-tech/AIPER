import React from 'react';
import { Clock, PlusCircle, CheckCircle, RotateCcw, Edit, RefreshCw, X } from 'lucide-react';
import { formatDateTime } from '../utils/dateUtils';

export default function GlobalJobHistory({ history, job, onClose }) {
  // Support passing either full job object or just history array
  const baseHistory = job?.history || history || [];
  
  const reassignEvents = [];
  if (job?.testInstances) {
    const instancesByDept = {};
    job.testInstances.forEach(inst => {
      // Skip reopened/cancelled — they are not head-reassign targets
      if (['REOPENED', 'CANCELLED'].includes(inst.status)) return;
      const dept = (inst.department || inst.createdBy?.department || inst.assignedTo?.department || '').toLowerCase();
      if (!dept) return;
      if (!instancesByDept[dept]) instancesByDept[dept] = [];
      instancesByDept[dept].push(inst);
    });

    Object.keys(instancesByDept).forEach(dept => {
      // Sort oldest-first
      const sorted = [...instancesByDept[dept]].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      sorted.forEach((inst, idx) => {
        const toAnalyst = inst.assignedTo?.name || 'Analyst';
        const instCreatedAt = new Date(inst.createdAt);

        if (idx === 0) {
          // First instance = initial dispatch — skip (already in job.history as DISPATCHED)
          // But still capture REASSIGN_MERGED on this instance (params sent back here)
          (inst.reviewHistory || [])
            .filter(rh => rh.action === 'REASSIGN_MERGED')
            .forEach(rh => {
              reassignEvents.push({
                action: 'REASSIGNED_TO_ANALYST',
                timestamp: rh.date,
                by: rh.by,
                note: `params merged back to ${toAnalyst}`,
              });
            });
          return;
        }

        // Each subsequent instance = a new analyst was assigned by the Head.
        // Find who triggered it: look at ALL previous siblings for a REASSIGN entry
        // that happened at or before this instance's creation time.
        let trigger = null;
        for (let p = idx - 1; p >= 0; p--) {
          const candidate = (sorted[p].reviewHistory || [])
            .filter(rh => ['REASSIGN', 'REASSIGN_MERGED'].includes(rh.action) && new Date(rh.date) <= instCreatedAt)
            .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
          if (candidate) { trigger = candidate; break; }
        }

        const fromAnalyst = sorted[idx - 1]?.assignedTo?.name;
        const note = fromAnalyst && fromAnalyst !== toAnalyst
          ? `from ${fromAnalyst} to ${toAnalyst}`
          : `to ${toAnalyst}`;

        reassignEvents.push({
          action: 'REASSIGNED_TO_ANALYST',
          // Use inst.createdAt as the event time — most reliable
          timestamp: inst.createdAt,
          by: trigger?.by || null,
          note,
        });

        // Also capture any REASSIGN_MERGED on this non-primary instance
        (inst.reviewHistory || [])
          .filter(rh => rh.action === 'REASSIGN_MERGED')
          .forEach(rh => {
            reassignEvents.push({
              action: 'REASSIGNED_TO_ANALYST',
              timestamp: rh.date,
              by: rh.by,
              note: `params merged back to ${toAnalyst}`,
            });
          });
      });
    });
  }

  const historyData = [...baseHistory, ...reassignEvents].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const getActionIcon = (action) => {
    switch (action) {
      case 'CREATED': return <PlusCircle size={16} />;
      case 'DISPATCHED': return <CheckCircle size={16} />;
      case 'RETURNED_TO_OFFICER': return <RotateCcw size={16} />;
      case 'RESUBMITTED': return <RefreshCw size={16} />;
      case 'UPDATED': return <Edit size={16} />;
      case 'RETEST_REQUESTED': return <RotateCcw size={16} />;
      case 'REASSIGNED_TO_ANALYST': return <RotateCcw size={16} />;
      case 'COMPLETED': return <CheckCircle size={16} />;
      default: return <Clock size={16} />;
    }
  };

  const getActionColor = (action) => {
    switch (action) {
      case 'CREATED': return 'var(--color-primary)';
      case 'DISPATCHED': return '#10B981';
      case 'RETURNED_TO_OFFICER': return '#EF4444';
      case 'RESUBMITTED': return '#F59E0B';
      case 'UPDATED': return '#3B82F6';
      case 'RETEST_REQUESTED': return '#F59E0B';
      case 'REASSIGNED_TO_ANALYST': return '#F59E0B';
      case 'COMPLETED': return '#10B981';
      default: return 'var(--color-text-muted)';
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, backdropFilter: 'blur(4px)'
    }}>
      <div className="card" style={{ width: '600px', maxWidth: '90%', padding: '2rem', animation: 'slideUp 0.3s ease', borderTop: '4px solid var(--color-primary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={20} color="var(--color-primary)" />
              Job History Timeline
            </h2>
            {job && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  backgroundColor: 'rgba(44, 62, 80, 0.07)',
                  padding: '0.2rem 0.55rem',
                  borderRadius: '999px',
                  letterSpacing: '0.04em',
                }}>
                  {job.jobCode}
                </span>
                <span style={{ color: 'var(--color-border)', fontSize: '0.9rem' }}>·</span>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                  {job.clientName}
                </span>
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', flexShrink: 0 }}>
            <X size={20} color="var(--color-text-muted)" />
          </button>
        </div>

        <div style={{ padding: '0.5rem', maxHeight: '60vh', overflowY: 'auto' }}>
          {historyData.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>No history available for this job.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
              {/* Vertical line connecting timeline dots */}
              <div style={{ position: 'absolute', top: '10px', bottom: '10px', left: '15px', width: '2px', backgroundColor: 'var(--color-border)', zIndex: 0 }} />
              
              {historyData.map((event, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '1rem', position: 'relative', zIndex: 1 }}>
                  <div style={{ 
                    minWidth: '32px', height: '32px', borderRadius: '50%', 
                    backgroundColor: 'white', border: `2px solid ${getActionColor(event.action)}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: getActionColor(event.action)
                  }}>
                    {getActionIcon(event.action)}
                  </div>
                  
                  <div style={{ flex: 1, backgroundColor: 'var(--color-surface-hover)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: getActionColor(event.action) }}>
                        {event.action.replace(/_/g, ' ')}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        {formatDateTime(event.timestamp)}
                      </div>
                    </div>
                    
                    <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>By:</span> 
                      <span style={{ fontWeight: 500 }}>{event.by?.name || 'Unknown User'}</span>
                    </div>
                    
                    {event.note && (
                      <div style={{ fontSize: '0.85rem', padding: '0.5rem', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', borderLeft: `3px solid ${getActionColor(event.action)}` }}>
                        <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Note: </span>
                        {event.note}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
