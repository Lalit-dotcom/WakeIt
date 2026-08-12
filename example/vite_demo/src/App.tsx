import { useState, useEffect } from "react";
import { WakeItProvider, WakeItBanner, useWakeIt, type WakeItConfig } from "wakeit";

function StatusCard() {
  const {
    status,
    isReady,
    isWarming,
    responseTimeMs,
    retryCount,
    bannerVisible,
    config,
    checkBackend,
    dismissBanner,
  } = useWakeIt();

  const [cacheTimestamp, setCacheTimestamp] = useState<string | null>(null);

  const updateCacheInfo = () => {
    const raw = localStorage.getItem("wakeit_backend_warmup_ts");
    if (raw) {
      const date = new Date(parseInt(raw, 10));
      setCacheTimestamp(date.toLocaleTimeString());
    } else {
      setCacheTimestamp(null);
    }
  };

  useEffect(() => {
    updateCacheInfo();
    const interval = setInterval(updateCacheInfo, 5000);
    return () => clearInterval(interval);
  }, []);

  const clearCache = () => {
    localStorage.removeItem("wakeit_backend_warmup_ts");
    updateCacheInfo();
  };

  return (
    <div style={{ background: "#18181b", padding: "24px", borderRadius: "16px", color: "#f4f4f5", fontFamily: "sans-serif" }}>
      <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "16px", color: "#fbbf24" }}>
        ⚡ WakeIt Live State Inspector
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "20px" }}>
        <div style={{ background: "#27272a", padding: "12px", borderRadius: "8px" }}>
          <div style={{ fontSize: "12px", color: "#a1a1aa" }}>Status</div>
          <div style={{ fontSize: "16px", fontWeight: "bold", color: status === "ready" ? "#4ade80" : status === "warming" ? "#facc15" : status === "error" ? "#f87171" : "#a1a1aa" }}>
            {status.toUpperCase()}
          </div>
        </div>

        <div style={{ background: "#27272a", padding: "12px", borderRadius: "8px" }}>
          <div style={{ fontSize: "12px", color: "#a1a1aa" }}>isReady / isWarming</div>
          <div style={{ fontSize: "14px", fontWeight: "600" }}>
            {isReady ? "Ready ✅" : isWarming ? "Warming ⏳" : "Idle ⏸️"}
          </div>
        </div>

        <div style={{ background: "#27272a", padding: "12px", borderRadius: "8px" }}>
          <div style={{ fontSize: "12px", color: "#a1a1aa" }}>Response Time</div>
          <div style={{ fontSize: "14px", fontWeight: "600" }}>
            {responseTimeMs !== null ? `${responseTimeMs}ms` : "N/A"}
          </div>
        </div>

        <div style={{ background: "#27272a", padding: "12px", borderRadius: "8px" }}>
          <div style={{ fontSize: "12px", color: "#a1a1aa" }}>Retry Count</div>
          <div style={{ fontSize: "14px", fontWeight: "600" }}>{retryCount}</div>
        </div>

        <div style={{ background: "#27272a", padding: "12px", borderRadius: "8px" }}>
          <div style={{ fontSize: "12px", color: "#a1a1aa" }}>Banner Visible</div>
          <div style={{ fontSize: "14px", fontWeight: "600" }}>{bannerVisible ? "YES 👁️" : "NO 🙈"}</div>
        </div>

        <div style={{ background: "#27272a", padding: "12px", borderRadius: "8px" }}>
          <div style={{ fontSize: "12px", color: "#a1a1aa" }}>localStorage Cache</div>
          <div style={{ fontSize: "12px", fontWeight: "600", color: cacheTimestamp ? "#4ade80" : "#f87171" }}>
            {cacheTimestamp ? `Warm @ ${cacheTimestamp}` : "No Cache"}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: "16px", fontSize: "13px", background: "#09090b", padding: "12px", borderRadius: "8px" }}>
        <strong>Current Endpoint:</strong> <code style={{ color: "#38bdf8" }}>{config.healthEndpoint}</code>
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button
          onClick={() => checkBackend(true)}
          style={{ background: "#3b82f6", color: "white", border: "none", padding: "8px 16px", borderRadius: "8px", cursor: "pointer", fontWeight: "600" }}
        >
          🔄 Force Health Check
        </button>

        <button
          onClick={clearCache}
          style={{ background: "#ef4444", color: "white", border: "none", padding: "8px 16px", borderRadius: "8px", cursor: "pointer", fontWeight: "600" }}
        >
          🗑️ Clear localStorage Cache
        </button>

        <button
          onClick={dismissBanner}
          style={{ background: "#52525b", color: "white", border: "none", padding: "8px 16px", borderRadius: "8px", cursor: "pointer", fontWeight: "600" }}
        >
          ✖️ Dismiss Banner
        </button>
      </div>
    </div>
  );
}

export function App() {
  const [scenario, setScenario] = useState<"A" | "B" | "C" | "D">("B");

  const scenarioEndpoints: Record<string, string> = {
    A: "/api/health?delay=100", // Fast response (<1500ms)
    B: "/api/health?delay=3500", // Cold start (>1500ms delay)
    C: "/api/health?delay=100", // Cache test
    D: "/api/health?fail=true", // Failure & Retry test
  };

  const configOverrides: WakeItConfig = {
    healthEndpoint: scenarioEndpoints[scenario],
    showBannerDelayMs: 1500,
    retryIntervalMs: 2000,
    maxRetries: 3,
    showBannerOnError: true,
  };

  const selectScenario = (s: "A" | "B" | "C" | "D") => {
    if (s === "C") {
      // Don't clear cache for C
    } else {
      localStorage.removeItem("wakeit_backend_warmup_ts");
    }
    setScenario(s);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#09090b", color: "#f4f4f5", padding: "40px 20px", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ maxWidth: "800px", margin: "0 auto" }}>
        <header style={{ textAlign: "center", marginBottom: "32px" }}>
          <h1 style={{ fontSize: "32px", fontWeight: "800", color: "#fbbf24", marginBottom: "8px" }}>
            ⚡ wakeit Package Local Test Suite
          </h1>
          <p style={{ color: "#a1a1aa", fontSize: "14px" }}>
            Testing the standalone <code style={{ color: "#f4f4f5" }}>wakeit</code> package built from <code style={{ color: "#f4f4f5" }}>wakeit-1.0.0.tgz</code>
          </p>
        </header>

        <section style={{ background: "#18181b", padding: "20px", borderRadius: "16px", marginBottom: "24px" }}>
          <h3 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "12px", color: "#38bdf8" }}>
            Select Test Scenario:
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px" }}>
            <button
              onClick={() => selectScenario("A")}
              style={{
                padding: "12px",
                borderRadius: "10px",
                border: scenario === "A" ? "2px solid #38bdf8" : "1px solid #3f3f46",
                background: scenario === "A" ? "#0284c7" : "#27272a",
                color: "white",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ fontWeight: "bold" }}>Scenario A</div>
              <div style={{ fontSize: "11px", opacity: 0.8 }}>Fast Backend (100ms)</div>
              <div style={{ fontSize: "10px", marginTop: "4px", color: "#bae6fd" }}>Expected: Silent (No banner)</div>
            </button>

            <button
              onClick={() => selectScenario("B")}
              style={{
                padding: "12px",
                borderRadius: "10px",
                border: scenario === "B" ? "2px solid #f59e0b" : "1px solid #3f3f46",
                background: scenario === "B" ? "#d97706" : "#27272a",
                color: "white",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ fontWeight: "bold" }}>Scenario B</div>
              <div style={{ fontSize: "11px", opacity: 0.8 }}>Cold Start (3.5s)</div>
              <div style={{ fontSize: "10px", marginTop: "4px", color: "#fde68a" }}>Expected: "Waking up server..."</div>
            </button>

            <button
              onClick={() => selectScenario("C")}
              style={{
                padding: "12px",
                borderRadius: "10px",
                border: scenario === "C" ? "2px solid #4ade80" : "1px solid #3f3f46",
                background: scenario === "C" ? "#16a34a" : "#27272a",
                color: "white",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ fontWeight: "bold" }}>Scenario C</div>
              <div style={{ fontSize: "11px", opacity: 0.8 }}>Cache Verification</div>
              <div style={{ fontSize: "10px", marginTop: "4px", color: "#bbf7d0" }}>Expected: Skip health ping</div>
            </button>

            <button
              onClick={() => selectScenario("D")}
              style={{
                padding: "12px",
                borderRadius: "10px",
                border: scenario === "D" ? "2px solid #f87171" : "1px solid #3f3f46",
                background: scenario === "D" ? "#dc2626" : "#27272a",
                color: "white",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ fontWeight: "bold" }}>Scenario D</div>
              <div style={{ fontSize: "11px", opacity: 0.8 }}>Failed Endpoint (500)</div>
              <div style={{ fontSize: "10px", marginTop: "4px", color: "#fecaca" }}>Expected: Retries & Error Banner</div>
            </button>
          </div>
        </section>

        <WakeItProvider key={scenario} config={configOverrides}>
          <StatusCard />
          <WakeItBanner />
        </WakeItProvider>
      </div>
    </div>
  );
}

export default App;
