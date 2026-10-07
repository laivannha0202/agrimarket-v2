import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
}

export function PageHeader({ title, subtitle, extra }: PageHeaderProps) {
  return (
    <div className="agri-page-header">
      <div>
        <h1 className="agri-page-title">{title}</h1>
        {subtitle ? <div className="agri-page-subtitle">{subtitle}</div> : null}
      </div>
      {extra ? <div>{extra}</div> : null}
    </div>
  );
}
