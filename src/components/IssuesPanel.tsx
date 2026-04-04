import React from 'react';
import type { CheckRecord } from '../mockData';

interface IssuesPanelProps {
  items: CheckRecord[];
}

export const IssuesPanel: React.FC<IssuesPanelProps> = ({ items }) => {
  const allIssues: { [key: string]: number } = {};

  items.forEach(item => {
    item.issues.forEach(issue => {
      allIssues[issue] = (allIssues[issue] || 0) + 1;
    });
  });

  const sortedIssues = Object.entries(allIssues)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (sortedIssues.length === 0) {
    return (
      <div className="alert alert-success" style={{ marginBottom: 16 }}>
        <span>✅</span>
        <span>ข้อมูลทั้งหมดสมบูรณ์ ไม่พบปัญหา</span>
      </div>
    );
  }

  const totalIssues = Object.values(allIssues).reduce((a, b) => a + b, 0);

  return (
    <div className="alert alert-warning issues-panel issues-panel-shell">
      <div className="issues-panel-header">
        <span>⚠️</span>
        <strong>พบปัญหา {totalIssues} รายการ — ปัญหาที่พบบ่อย:</strong>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {sortedIssues.map(([issue, count]) => (
          <span
            key={issue}
            className="badge badge-warning"
          >
            {issue} × {count}
          </span>
        ))}
      </div>
    </div>
  );
};
