import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

const STATUS_COLORS = {
  nouveau: '#D83B01',
  en_revue: '#3b82f6',
  discussion: '#8b5cf6',
  en_developpement: '#059669',
  termine: '#64748b',
  non_poursuivi: '#dc2626',
  consideration_future: '#d97706',
  en_pause: '#94a3b8',
};

export default function IdeaCard({ idea, onContextMenu, isDragOverlay = false }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: idea.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`kanban-card ${isDragOverlay ? 'kanban-card--overlay' : ''} ${isDragging ? 'kanban-card--dragging' : ''}`}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(e, idea); }}
      {...attributes}
      {...listeners}
    >
      <div className="kanban-card-header">
        <span className="kanban-card-title">{idea.title}</span>
        <span className="kanban-status-dot" style={{ backgroundColor: STATUS_COLORS[idea.status] || '#94a3b8' }} />
      </div>
      {idea.author && <div className="kanban-card-author">{idea.author}</div>}
      <div className="kanban-card-footer">
        {idea.ki !== null && idea.ki !== undefined && (
          <span className="kanban-ki-badge">{idea.ki}/100</span>
        )}
        <span className="kanban-card-time">{timeAgo(idea.updatedAt)}</span>
      </div>
    </div>
  );
}
