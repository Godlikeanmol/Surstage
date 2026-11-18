import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected error occurred.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('SurStage ErrorBoundary caught:', error, errorInfo);
  }

  private handleReload = () => {
    this.setState({ hasError: false, errorMessage: '' });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh bg-[#0B0D12] text-[#F4F5F8] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#141720] border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-semibold">Stage Session Interrupted</h2>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              Something interrupted the session state. Reload to rejoin your karaoke room cleanly.
            </p>
            <div className="text-xs font-mono-tabular text-slate-400 bg-black/40 border border-white/5 rounded-xl p-3 break-words">
              {this.state.errorMessage}
            </div>
            <button
              onClick={this.handleReload}
              className="w-full min-h-[44px] rounded-xl bg-[#FF5A36] text-white font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[#ff6d4d] transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reload SurStage
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
