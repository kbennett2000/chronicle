import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

/** Without this, any unhandled render-time exception unmounts the whole
 * tree and leaves a blank screen with nothing but a console stack trace —
 * see issue #33's black-screen-on-first-connect report, which had no
 * visible signal at all that anything had gone wrong. */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] caught render error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          className="screen leather-ground"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            textAlign: "center",
            gap: 12,
          }}
        >
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--ink)" }}>
            Something went wrong
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-dim)", maxWidth: 320 }}>
            {this.state.error.message || "An unexpected error occurred."}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 8,
              cursor: "pointer",
              padding: "10px 18px",
              borderRadius: 3,
              background: "linear-gradient(180deg,#d8743e,#a8511f)",
              border: "none",
              color: "#faf0e2",
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: 1.5,
            }}
          >
            TRY AGAIN
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
