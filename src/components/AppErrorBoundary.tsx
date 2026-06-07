import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  onError?: (message: string) => void;
};

type State = {
  message: string | null;
};

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "화면을 표시하는 중 오류가 발생했습니다.";
    return { message };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "화면을 표시하는 중 오류가 발생했습니다.";
    this.props.onError?.(message);
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.message) {
      return (
        <div
          className="launch-shell app-error-boundary"
          role="alert"
          style={{
            minHeight: "100dvh",
            padding: "1.25rem",
            background: "var(--bg, #15181d)",
            color: "var(--text, #dce1e8)",
          }}
        >
          <div
            className="card"
            style={{
              width: "min(520px, 100%)",
              margin: "0 auto",
              padding: "1rem 1.05rem",
            }}
          >
            <p style={{ margin: "0 0 0.35rem", fontWeight: 800 }}>로딩 중 오류</p>
            <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.55, color: "var(--muted, #8a929e)" }}>
              {this.state.message}
            </p>
            <button
              type="button"
              className="btn btn--primary"
              style={{ marginTop: "0.85rem" }}
              onClick={() => window.location.reload()}
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
