import { Link } from 'react-router-dom';
import TaskCard, { taskUrgencyLevel } from '../tasks/TaskCard.jsx';
import { taskSortAnchor } from '../../utils/taskSort.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const SECTIONS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Due today' },
  { id: 'week', label: 'This week' },
  { id: 'future', label: 'Upcoming' },
  { id: 'none', label: 'No date' },
];

export default function CaseloadTasksSection({
  tasks,
  resolveUser,
  resolvePatient,
  resolvePatientRecord,
  onStatusChange,
}) {
  const grouped = SECTIONS.map((s) => ({
    ...s,
    items: (tasks || []).filter((t) => taskUrgencyLevel(taskSortAnchor(t)) === s.id),
  })).filter((s) => s.items.length > 0);

  return (
    <section
      id="caseload-tasks"
      style={{
        marginBottom: 22,
        padding: '16px 16px 12px',
        borderRadius: 12,
        border: '1px solid var(--color-border)',
        background: palette.backgroundLight.hex,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>
            Open tasks
          </h2>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.42), margin: '3px 0 0' }}>
            Assigned to you · sorted by due / scheduled date
          </p>
        </div>
        <Link
          to="/tasks"
          style={{
            fontSize: 12, fontWeight: 650, color: palette.primaryMagenta.hex,
            textDecoration: 'none', flexShrink: 0,
          }}
        >
          All tasks →
        </Link>
      </div>

      {(!tasks || tasks.length === 0) ? (
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: '8px 0 4px' }}>
          No open tasks. New work assigned to you will show up here.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {grouped.map((section) => (
            <div key={section.id}>
              <p style={{
                fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: hexToRgba(palette.backgroundDark.hex, 0.4),
                margin: '0 0 8px',
              }}>
                {section.label}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {section.items.map((task) => (
                  <TaskCard
                    key={task._id || task.id}
                    task={task}
                    resolveUser={resolveUser}
                    resolvePatient={resolvePatient}
                    resolvePatientRecord={resolvePatientRecord}
                    onStatusChange={onStatusChange}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
