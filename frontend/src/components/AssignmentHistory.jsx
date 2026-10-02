import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, History, CheckCircle, ArrowRightLeft, RotateCcw } from 'lucide-react';
import { formatDateTime } from '../utils/dateUtils';

const DEPT_COLORS = {
  micro:    { bg: '#EEF2FF', border: '#C7D2FE', text: '#4338CA' },
  chemical: { bg: '#ECFDF5', border: '#A7F3D0', text: '#065F46' },
};

const ACTION_CONFIG = {
  ASSIGN:          { label: 'Dispatched',      color: '#3B82F6', Icon: CheckCircle },
  REASSIGN:        { label: 'Reassigned',       color: '#F59E0B', Icon: ArrowRightLeft },
  REASSIGN_MERGED: { label: 'Params merged in', color: '#8B5CF6', Icon: ArrowRightLeft },
  APPROVE:         { label: 'Approved',         color: '#10B981', Icon: CheckCircle },
  REJECT:          { label: 'Rejected',         color: '#EF4444', Icon: RotateCcw },
  RETURN:          { label: 'Returned',         color: '#F59E0B', Icon: RotateCcw },
};

export default function AssignmentHistory({ testInstances = [] }) {
  const [isOpen, setIsOpen]       = useState(false);
  const [rendered, setRendered]   = useState(false); // lazy-render guard
  const [loading, setLoading]     = useState(false);
  const rafRef                    = useRef(null);

  // Memoize the expensive flatMap+sort so it only recomputes when testInstances changes
  const history = useMemo(() => {
    return testInstances
      .flatMap(inst => (inst.reviewHistory || []).map(rh => ({
        ...rh,
        analystName: inst.assignedTo?.name,
        testCode:    inst.testCode,
        department:  (inst.department || inst.createdBy?.department || '').toLowerCase(),
      })))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [testInstances]);

  const hasDualDept = useMemo(
    () => new Set(history.map(e => e.department).filter(Boolean)).size > 1,
    [history]
  );

  // On first open: show spinner for one frame, then mount the list
  useEffect(() => {
    if (isOpen && !rendered) {
      setLoading(true);
      rafRef.current = requestAnimationFrame(() => {
        setRendered(true);
        setLoading(false);
      });
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isOpen, rendered]);

  const handleToggle = () => {
    if (history.length === 0) return;
    setIsOpen(prev => !prev);
  };

  return (
    <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
      <button
        onClick={handleToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.4rem 0',
          background: 'none',
          border: 'none',
          color: history.length === 0 ? 'var(--color-text-muted)' : 'var(--color-text-main)',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: history.length === 0 ? 'default' : 'pointer',
          width: '100%',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <History size={15} style={{ opacity: history.length === 0 ? 0.5 : 1 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.05rem', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>Assignment History</span>
            {history.length > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: '20px', height: '20px', padding: '0 6px', borderRadius: '10px',
                backgroundColor: 'var(--color-primary)', color: '#fff',
                fontSize: '0.72rem', fontWeight: 700,
              }}>
                {history.length}
              </span>
            )}
          </div>
          <span style={{ fontSize: '0.72rem', fontWeight: 400, color: 'var(--color-text-muted)' }}>
            {history.length === 0
              ? 'No analyst dispatch or reassignment events yet'
              : 'Analyst dispatch and reassignment audit log'}
          </span>
        </div>
        {history.length > 0 && (
          <div style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
            {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </div>
        )}
      </button>

      {isOpen && (
        loading ? (
          /* One-frame loading buffer so the browser can paint before heavy list renders */
          <div style={{ padding: '1rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
            <div style={{
              width: '14px', height: '14px', borderRadius: '50%',
              border: '2px solid var(--color-border)',
              borderTopColor: 'var(--color-primary)',
              animation: 'spin 0.6s linear infinite',
            }} />
            Loading history…
          </div>
        ) : rendered && history.length > 0 && (
          <div style={{ marginTop: '0.75rem', paddingLeft: '0.5rem' }}>
            {history.map((entry, idx) => {
              const cfg    = ACTION_CONFIG[entry.action] || { label: entry.action, color: '#6B7280', Icon: History };
              const { Icon } = cfg;
              const isLast = idx === history.length - 1;
              const dept   = entry.department;
              const deptColors = DEPT_COLORS[dept] || null;

              let actionLine = cfg.label;
              if (['REASSIGN', 'REASSIGN_MERGED'].includes(entry.action) && entry.analystName) {
                actionLine = `${cfg.label} to ${entry.analystName}`;
              } else if (entry.action === 'APPROVE' && entry.analystName) {
                actionLine = `Results approved for ${entry.analystName}`;
              } else if (entry.action === 'REJECT' && entry.analystName) {
                actionLine = `Results rejected for ${entry.analystName}`;
              }

              return (
                <div key={idx} style={{ display: 'flex', gap: '0.75rem', position: 'relative' }}>
                  {/* Dot + vertical connector */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{
                      width: '26px', height: '26px', borderRadius: '50%',
                      backgroundColor: cfg.color + '1A', border: `2px solid ${cfg.color}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <Icon size={12} color={cfg.color} />
                    </div>
                    {!isLast && (
                      <div style={{ width: '2px', flex: 1, minHeight: '24px', backgroundColor: 'var(--color-border)', marginTop: '4px', marginBottom: '4px' }} />
                    )}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, paddingBottom: isLast ? '0' : '1rem', marginTop: '2px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--color-text-main)' }}>
                          {actionLine}
                        </span>
                        {hasDualDept && dept && deptColors && (
                          <span style={{
                            fontSize: '0.7rem', fontWeight: 600, textTransform: 'capitalize',
                            padding: '1px 7px', borderRadius: '999px',
                            backgroundColor: deptColors.bg, color: deptColors.text,
                            border: `1px solid ${deptColors.border}`,
                          }}>
                            {dept}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {formatDateTime(entry.date)}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                      {entry.by?.name
                        ? `by ${entry.by.name} (${entry.role === 'HEAD' ? 'Dept Head' : entry.role === 'ADMIN_OFFICER' ? 'Admin Officer' : entry.role || 'System'})`
                        : 'System'}
                    </div>

                    {entry.note && (
                      <div style={{
                        marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--color-text-main)',
                        backgroundColor: 'var(--color-surface-hover)',
                        borderLeft: `3px solid ${cfg.color}`,
                        padding: '0.3rem 0.6rem', borderRadius: '0 4px 4px 0', lineHeight: 1.45,
                      }}>
                        {entry.note}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
