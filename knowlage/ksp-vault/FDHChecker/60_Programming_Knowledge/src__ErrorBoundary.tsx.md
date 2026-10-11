---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/ErrorBoundary.tsx"
source_hash: "468351f2b4713a57b63eb43cdc89b90375f40db525543db1470fa211d27a8cba"
managed_by: "sync-ksp-vault"
---
# ErrorBoundary.tsx

> Source: `src/ErrorBoundary.tsx`
> SHA-256: `468351f2b4713a57b63eb43cdc89b90375f40db525543db1470fa211d27a8cba`

````tsx
import React from 'react';
import type { ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, background: '#ffebee', color: '#c62828' }}>
          <h1>❌ Error</h1>
          <pre>{this.state.error?.message}</pre>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

````
