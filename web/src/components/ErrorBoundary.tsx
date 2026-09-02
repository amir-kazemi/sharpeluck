import { Component, type ReactNode } from "react";

/** One malformed run must not blank the page. Results are files on disk that
 *  outlive the code that wrote them, so a render error here is a data-shape
 *  problem worth showing, not worth crashing over. */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="card" style={{ borderColor: "var(--critical)" }}>
        <h3 style={{ color: "var(--critical)" }}>
          <span aria-hidden>✕ </span>Could not render this run
        </h3>
        <p className="sub">
          The stored results are not in a shape this build understands. Re-running
          the audit will produce current artefacts.
        </p>
        <pre className="sub" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
          {this.state.error.message}
        </pre>
      </section>
    );
  }
}
