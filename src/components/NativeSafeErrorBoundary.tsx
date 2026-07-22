import { Component, type ErrorInfo, type ReactNode } from "react";

import { reportLovableError } from "@/lib/lovable-error-reporting";

type Props = {
  children: ReactNode;
};

type State = {
  failed: boolean;
  message: string;
};

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error instanceof Event) return error.type;
  return String(error || "تعذر تشغيل جزء من التطبيق");
}

export class NativeSafeErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, message: toMessage(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    reportLovableError(error, { boundary: "native-safe", componentStack: info.componentStack });
  }

  private reset = () => {
    this.setState({ failed: false, message: "" });
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center px-5" dir="rtl">
        <section className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 text-center text-card-foreground shadow-lg">
          <h1 className="text-lg font-black">التطبيق لم يتوقف</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            أعدنا تشغيل هذا الجزء بأمان. اضغط متابعة للرجوع للتطبيق.
          </p>
          {this.state.message && (
            <p className="mt-3 rounded-xl bg-muted p-3 text-start text-[11px] text-muted-foreground" dir="ltr">
              {this.state.message.slice(0, 240)}
            </p>
          )}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button onClick={this.reset} className="rounded-xl border border-border px-3 py-2 text-sm font-bold">
              متابعة
            </button>
            <button onClick={() => window.location.reload()} className="rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground">
              إعادة تحميل
            </button>
          </div>
        </section>
      </main>
    );
  }
}