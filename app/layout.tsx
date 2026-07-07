import type { ReactNode } from "react";

export const metadata = {
  title: "PLA — goal-to-graph test harness",
  description: "Minimal API wrapper for testing the Phase 2 goal-to-graph pipeline",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "2rem" }}>{children}</body>
    </html>
  );
}
