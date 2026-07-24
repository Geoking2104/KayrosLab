import { useState, useCallback, useSyncExternalStore, useRef, useEffect } from 'react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { STAGES, STATUSES, getIdeasByStage, getWipWarnings, moveIdea, updateStatus, deleteIdea, subscribe, getSnapshot } from '../data/ideaStore.js';
import IdeaCard from './IdeaCard.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

function useForceUpdate() {
  const [, setTick] = useState(0);
  return useCallback(() => setTick((t) => t + 1), []);
}

export default function IdeaKanban() {
  const { t } = useI18n();
  const forceUpdate = useForceUpdate();
  const ideas = useSyncExternalStore(subscribe, getSnapshot);
  const [activeId, setActiveId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const menuRef = useRef(null);

  const byStage = getIdeasByStage();
  const wips = getWipWarnings();
  const activeIdea = ideas.find((i) => i.id === activeId);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setContextMenu(null);
    };
    if (contextMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  const handleDragStart = useCallback((event) => { setActiveId(event.active.id); }, []);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const targetStage = over.id;
    if (STAGES.includes(targetStage) && active.id !== targetStage) {
      const result = moveIdea(active.id, targetStage);
      if (result.ok) forceUpdate();
    }
  }, [forceUpdate]);

  const handleStatusChange = useCallback((ideaId, newStatus) => {
    updateStatus(ideaId, newStatus);
    setContextMenu(null);
    forceUpdate();
  }, [forceUpdate]);

  const handleDelete = useCallback((ideaId) => {
    deleteIdea(ideaId);
    setContextMenu(null);
    forceUpdate();
  }, [forceUpdate]);

  const handleContextMenu = useCallback((e, idea) => {
    setContextMenu({ x: e.clientX, y: e.clientY, idea });
  }, []);

  const statusLabel = (s) => {
    const labels = {
      nouveau: t('kanban.statuses.nouveau'), en_revue: t('kanban.statuses.en_revue'),
      discussion: t('kanban.statuses.discussion'), en_developpement: t('kanban.statuses.en_developpement'),
      termine: t('kanban.statuses.termine'), non_poursuivi: t('kanban.statuses.non_poursuivi'),
      consideration_future: t('kanban.statuses.consideration_future'), en_pause: t('kanban.statuses.en_pause'),
    };
    return labels[s] || s;
  };

  return (
    <div className="kanban-container">
      <h3 className="kanban-title">{t('kanban.title')}</h3>
      <p className="kanban-subtitle">{t('kanban.subtitle')}</p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="kanban-board">
          {STAGES.map((stage) => {
            const stageIdeas = byStage[stage] || [];
            const isOverWip = wips[stage];
            return (
              <div key={stage} className="kanban-column">
                <div className="kanban-column-header">
                  <div className="kanban-column-title">
                    <span>{t(`kanban.stages.${stage}`)}</span>
                    <span className="kanban-column-count">{stageIdeas.length}</span>
                  </div>
                  {isOverWip && (
                    <div className="kanban-wip-warning">
                      {t('kanban.wipWarning', { n: stageIdeas.length })}
                    </div>
                  )}
                </div>
                <SortableContext items={stageIdeas.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <div
                    className={`kanban-column-body ${stageIdeas.length === 0 ? 'kanban-column-body--empty' : ''}`}
                    data-stage={stage}
                  >
                    {stageIdeas.length === 0 ? (
                      <div className="kanban-empty-text">{t('kanban.dropHere')}</div>
                    ) : (
                      stageIdeas.map((idea) => (
                        <IdeaCard key={idea.id} idea={idea} onContextMenu={handleContextMenu} />
                      ))
                    )}
                  </div>
                </SortableContext>
              </div>
            );
          })}
        </div>

        <DragOverlay>
          {activeIdea ? <IdeaCard idea={activeIdea} isDragOverlay /> : null}
        </DragOverlay>
      </DndContext>

      {contextMenu && (
        <div
          ref={menuRef}
          className="kanban-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="kanban-context-menu-title">{t('kanban.contextMenu.status')}</div>
          {STATUSES.map((status) => (
            <button
              key={status}
              className={`kanban-context-menu-item ${contextMenu.idea.status === status ? 'kanban-context-menu-item--active' : ''}`}
              onClick={() => handleStatusChange(contextMenu.idea.id, status)}
            >
              <span className="kanban-status-dot" style={{
                backgroundColor: contextMenu.idea.status === status ? 'var(--color-accent)' : 'var(--color-text-5)',
                width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
              }} />
              {statusLabel(status)}
            </button>
          ))}
          <div className="kanban-context-menu-sep" />
          <button
            className="kanban-context-menu-item kanban-context-menu-item--danger"
            onClick={() => handleDelete(contextMenu.idea.id)}
          >
            {t('kanban.contextMenu.delete')}
          </button>
        </div>
      )}
    </div>
  );
}
