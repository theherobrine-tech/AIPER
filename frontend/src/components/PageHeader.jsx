import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, ChevronUp, X, Filter, SlidersHorizontal } from 'lucide-react';

export default function PageHeader({ config, controls, resultCount, totalCount, onSearchChange, filterSelectOptions = {} }) {
  const [localQuery, setLocalQuery] = useState(controls.searchQuery);
  const debounceRef = useRef(null);
  
  const [activePanel, setActivePanel] = useState(null); // 'sort' | 'filter' | null
  const panelRef = useRef(null);
  
  const { sortOptions = [], filterDefs = [] } = config;
  const { sortKey, sortDir, setSortKey, toggleSortDir, activeFilters, setFilter, clearFilter, clearAll, isFiltered } = controls;

  const [renderedFilters, setRenderedFilters] = useState(activeFilters);
  useEffect(() => {
    if (Object.keys(activeFilters).length === 0 && Object.keys(renderedFilters).length > 0) {
      const timer = setTimeout(() => {
        setRenderedFilters({});
      }, 300);
      return () => clearTimeout(timer);
    } else if (Object.keys(activeFilters).length > 0) {
      setRenderedFilters(activeFilters);
    }
  }, [activeFilters]);

  useEffect(() => {
    setLocalQuery(controls.searchQuery);
  }, [controls.searchQuery]);

  const handleSearchInput = (e) => {
    const val = e.target.value;
    setLocalQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearchChange && onSearchChange(val);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 300);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setActivePanel(null);
      }
    };
    if (activePanel) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activePanel]);

  // Scroll to top on sort/filter change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [sortKey, sortDir, activeFilters]);

  const togglePanel = (panel) => {
    setActivePanel(prev => prev === panel ? null : panel);
  };

  return (
    <div className="page-header" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        
        {/* Search */}
        <div style={{ flex: 1, minWidth: '200px', display: 'flex', alignItems: 'center', background: 'var(--color-surface-hover)', borderRadius: 'var(--radius-md)', padding: '0.4rem 0.75rem', border: '1px solid var(--color-border)' }}>
          <Search size={16} color="var(--color-text-muted)" style={{ marginRight: '0.5rem' }} />
          <input
            type="text"
            placeholder="Search..."
            value={localQuery}
            onChange={handleSearchInput}
            style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.9rem' }}
          />
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }} ref={panelRef}>
          <button
            onClick={() => togglePanel('sort')}
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem', borderColor: sortKey !== config.defaultSortKey ? 'var(--color-primary)' : 'var(--color-border)' }}
          >
            <SlidersHorizontal size={16} />
            Sort
            <ChevronDown size={14} />
          </button>

          <button
            onClick={() => togglePanel('filter')}
            className="btn btn-secondary"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.4rem', 
              padding: '0.4rem 0.75rem', 
              borderColor: Object.keys(activeFilters).length > 0 ? 'var(--color-primary)' : 'var(--color-border)',
              color: Object.keys(activeFilters).length > 0 ? 'white' : 'inherit',
              backgroundColor: Object.keys(activeFilters).length > 0 ? 'var(--color-primary)' : 'transparent'
            }}
          >
            <Filter size={16} />
            Filter
            <ChevronDown size={14} />
          </button>

          {/* Panels */}
          {activePanel === 'sort' && (
            <div className="list-controls-panel">
              <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Sort by</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {sortOptions.map(opt => {
                  const isActive = sortKey === opt.key;
                  return (
                    <div 
                      key={opt.key}
                      onClick={() => {
                        if (isActive) toggleSortDir();
                        else setSortKey(opt.key);
                      }}
                      style={{ 
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                        padding: '0.5rem', borderRadius: 'var(--radius-md)', 
                        cursor: 'pointer', background: isActive ? 'var(--color-surface-hover)' : 'transparent',
                        fontWeight: isActive ? 600 : 400
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: '12px', height: '12px', borderRadius: '50%', border: '1px solid var(--color-primary)', background: isActive ? 'var(--color-primary)' : 'transparent' }} />
                        {opt.label}
                      </div>
                      {isActive && (
                        sortDir === 'asc' ? <ChevronUp size={16} /> : <ChevronDown size={16} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activePanel === 'filter' && (
            <div className="list-controls-panel">
              <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Filters</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {filterDefs.map((def, index) => {
                  const current = activeFilters[def.id] || { value: '', mode: 'include' };
                  const isActive = !!activeFilters[def.id];
                  const isLast = index === filterDefs.length - 1;

                  return (
                    <div key={def.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderBottom: isLast ? 'none' : '1px solid var(--color-border)', paddingBottom: isLast ? '0' : '0.75rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{def.label}</span>
                      
                      {def.type === 'toggle' ? (
                        <div className="mode-toggle">
                          <button
                            className={isActive && current.mode === 'include' ? 'active' : ''}
                            onClick={() => {
                              if (isActive && current.mode === 'include') clearFilter(def.id);
                              else setFilter(def.id, true, 'include');
                            }}
                          >
                            Include
                          </button>
                          <button
                            className={isActive && current.mode === 'exclude' ? 'active' : ''}
                            onClick={() => {
                              if (isActive && current.mode === 'exclude') clearFilter(def.id);
                              else setFilter(def.id, true, 'exclude');
                            }}
                          >
                            Exclude
                          </button>
                        </div>
                      ) : (
                        <div className="mode-toggle">
                          <button
                            className={isActive && current.mode === 'include' ? 'active' : ''}
                            onClick={() => {
                              if (current.value) {
                                setFilter(def.id, current.value, 'include');
                              } else if (def.type === 'select' && def.hideAnyOption) {
                                const opts = filterSelectOptions[def.id] || def.options || [];
                                if (opts.length > 0) setFilter(def.id, opts[0].value, 'include');
                              }
                            }}
                          >
                            Include
                          </button>
                          <button
                            className={isActive && current.mode === 'exclude' ? 'active' : ''}
                            onClick={() => {
                              if (current.value) {
                                setFilter(def.id, current.value, 'exclude');
                              } else if (def.type === 'select' && def.hideAnyOption) {
                                const opts = filterSelectOptions[def.id] || def.options || [];
                                if (opts.length > 0) setFilter(def.id, opts[0].value, 'exclude');
                              }
                            }}
                          >
                            Exclude
                          </button>
                        </div>
                      )}

                      {def.type === 'select' && (
                        <select 
                          value={isActive ? current.value : ''}
                          onChange={(e) => {
                            if (e.target.value) setFilter(def.id, e.target.value, current.mode);
                            else clearFilter(def.id);
                          }}
                          style={{ padding: '0.4rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: '0.85rem', width: '100%' }}
                        >
                          {!def.hideAnyOption && <option value="">Any</option>}
                          {(filterSelectOptions[def.id] || def.options || []).map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      )}

                      {def.type === 'dateRange' && (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <input 
                            type="date" 
                            value={isActive ? (current.value.from || '') : ''}
                            onChange={(e) => {
                              const v = { ...(isActive ? current.value : {}), from: e.target.value };
                              if (!v.from && !v.to) clearFilter(def.id);
                              else setFilter(def.id, v, current.mode);
                            }}
                            style={{ flex: 1, padding: '0.3rem', fontSize: '0.8rem', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                          />
                          <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                          <input 
                            type="date" 
                            value={isActive ? (current.value.to || '') : ''}
                            onChange={(e) => {
                              const v = { ...(isActive ? current.value : {}), to: e.target.value };
                              if (!v.from && !v.to) clearFilter(def.id);
                              else setFilter(def.id, v, current.mode);
                            }}
                            style={{ flex: 1, padding: '0.3rem', fontSize: '0.8rem', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={`active-filters-wrapper ${isFiltered ? 'expanded' : ''}`}>
        <div className="active-filters-inner">
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>Showing {resultCount} of {totalCount} items</span>
          </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', paddingTop: '0.25rem' }}>
              {Object.entries(renderedFilters).map(([filterId, state]) => {
                const def = filterDefs.find(d => d.id === filterId);
                if (!def) return null;
                let valLabel = '';
                if (def.type === 'select') {
                  const opts = filterSelectOptions[def.id] || def.options || [];
                  const found = opts.find(o => String(o.value) === String(state.value));
                  valLabel = found ? found.label : state.value;
                } else if (def.type === 'dateRange') {
                  valLabel = `${state.value.from || '...'} to ${state.value.to || '...'}`;
                }

                return (
                  <div key={filterId} className="filter-chip">
                    <span>{def.label}{valLabel ? `: ${valLabel}` : ''} ({state.mode})</span>
                    <button onClick={() => clearFilter(filterId)}>
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
              
              {Object.keys(renderedFilters).length > 0 && (
                <button 
                  onClick={clearAll} 
                  style={{ 
                    fontSize: '0.82rem', 
                    padding: '0.3rem 0.75rem', 
                    border: 'none', 
                    background: 'transparent',
                    color: 'var(--color-danger)',
                    cursor: 'pointer',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  Clear All
                </button>
              )}
            </div>
        </div>
      </div>
    </div>
  );
}
