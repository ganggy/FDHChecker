import React from 'react';

interface DashboardStatsProps {
  total: number;
  completed: number;
  incomplete: number;
  reviewed: number;
  totalPrice: number;
}

export const DashboardStats: React.FC<DashboardStatsProps> = ({
  total,
  completed,
  incomplete,
  reviewed,
  totalPrice,
}) => {
  const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;

  return (
    <div className="dashboard-stats-grid">
      <StatCard
        title="จำนวนรายการทั้งหมด"
        value={total}
        color="#1976d2"
        icon="📋"
        chip="ทั้งหมด"
      />
      <StatCard
        title="สมบูรณ์"
        value={completed}
        color="#4caf50"
        icon="✅"
        chip="พร้อมส่ง"
      />
      <StatCard
        title="ไม่สมบูรณ์"
        value={incomplete}
        color="#f44336"
        icon="⚠️"
        chip="รอแก้"
      />
      <StatCard
        title="ตรวจสอบแล้ว"
        value={reviewed}
        color="#ff9800"
        icon="🔎"
        chip="Review"
      />
      <StatCard
        title="อัตราความสมบูรณ์"
        value={`${completionRate}%`}
        color="#673ab7"
        icon="📈"
        chip="Quality"
      />
      <StatCard
        title="มูลค่ารวม"
        value={`${totalPrice.toLocaleString()} บาท`}
        color="#009688"
        icon="💰"
        chip="Value"
      />
    </div>
  );
};

interface StatCardProps {
  title: string;
  value: string | number;
  color: string;
  icon: string;
  chip: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, color, icon, chip }) => (
  <div className="stat-card dashboard-stat-card" style={{ ['--stat-color' as string]: color }}>
    <div className="dashboard-stat-top">
      <div className="dashboard-stat-icon">{icon}</div>
      <div className="dashboard-stat-chip">{chip}</div>
    </div>
    <div className="stat-label">{title}</div>
    <div className="stat-value" style={{ color }}>
      {value}
    </div>
  </div>
);
